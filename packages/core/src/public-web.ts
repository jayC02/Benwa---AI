import https from "node:https";
import dns from "node:dns/promises";
import { z } from "zod";
import { env } from "./config.js";
import { langSearch, firecrawlRead } from "./external-research.js";

export function publicIPv4(address: string) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false;
  const parts = address.split(".").map(Number),
    [a, b, c] = parts;
  return (
    !parts.some((part) => part > 255) &&
    !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  );
}
export function researchUrl(raw: string) {
  const url = new URL(raw),
    hosts = env.RESEARCH_HOSTS.split(",").map((host) =>
      host.trim().toLowerCase(),
    );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    (!hosts.includes("*") && !hosts.includes(url.hostname))
  )
    throw new Error(
      "Research URL is outside the operator-approved public HTTPS scope",
    );
  return url;
}
export async function approvedUrl(raw: string) {
  const url = researchUrl(raw),
    addresses = await dns.lookup(url.hostname, { all: true });
  const ipv4 = addresses.filter((address) => address.family === 4);
  if (!ipv4.length || ipv4.some((address) => !publicIPv4(address.address)))
    throw new Error("Private or unsupported DNS destination rejected");
  return { url, address: ipv4[0].address };
}
interface WebResponse {
  status: number;
  body: string;
  location?: string;
}
const cooldowns = new Map<string, number>();
async function pinnedGet(raw: string): Promise<WebResponse> {
  const { url, address } = await approvedUrl(raw);
  if ((cooldowns.get(url.hostname) ?? 0) > Date.now())
    throw new Error("Research host is cooling down after a rate limit");
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "BenwaResearch/0.1 (personal public research; no login)",
          Accept: "text/html,text/plain,application/json",
        },
        family: 4,
        lookup: (_host, _options, callback) => callback(null, address, 4),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status === 429 || status === 503) {
          const value = String(response.headers["retry-after"] ?? "60"),
            seconds = Number(value);
          const until = Number.isFinite(seconds)
            ? Date.now() + seconds * 1000
            : Date.parse(value);
          cooldowns.set(
            url.hostname,
            Math.max(Date.now() + 60000, Number.isFinite(until) ? until : 0),
          );
        }
        if (status !== 200) {
          response.resume();
          resolve({ status, body: "", location: response.headers.location });
          return;
        }
        if (
          !/text\/|application\/(json|.*\+json)/i.test(
            String(response.headers["content-type"]),
          )
        ) {
          response.resume();
          reject(new Error("Unsupported research content type"));
          return;
        }
        let body = "",
          bytes = 0;
        response.setEncoding("utf8");
        response.on("data", (part: string) => {
          bytes += Buffer.byteLength(part);
          if (bytes > 1000000) {
            request.destroy(new Error("Research response too large"));
            return;
          }
          body += part;
        });
        response.on("end", () => resolve({ status, body }));
        response.on("error", reject);
      },
    );
    request.setTimeout(12000, () =>
      request.destroy(new Error("Research timeout")),
    );
    request.on("error", reject);
  });
}
export function robotsAllows(robots: string, pathname: string) {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };
  const groups: Group[] = [];
  let group: Group = { agents: [], rules: [] };
  for (const raw of robots.split("\n")) {
    const line = raw.split("#")[0].trim(),
      colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).toLowerCase(),
      value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (group.rules.length) {
        groups.push(group);
        group = { agents: [], rules: [] };
      }
      group.agents.push(value.toLowerCase());
    } else if (
      (key === "disallow" || key === "allow") &&
      value &&
      group.agents.length
    )
      group.rules.push({ allow: key === "allow", path: value });
  }
  groups.push(group);
  const scored = groups.map((item) => ({
    ...item,
    score: Math.max(
      -1,
      ...item.agents.map((agent) =>
        agent === "*"
          ? 0
          : agent && "benwaresearch".includes(agent)
            ? agent.length
            : -1,
      ),
    ),
  }));
  const best = Math.max(-1, ...scored.map((item) => item.score));
  const matches = scored
    .filter((item) => item.score === best && best >= 0)
    .flatMap((item) => item.rules)
    .filter((rule) => {
      const expression =
        "^" +
        rule.path
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*")
          .replace(/\\\$$/, "$");
      return new RegExp(expression).test(pathname);
    })
    .sort(
      (a, b) =>
        b.path.length - a.path.length || Number(b.allow) - Number(a.allow),
    );
  return matches[0]?.allow ?? true;
}
function plainText(html: string) {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
export function publicLinks(html: string, base: string) {
  const links = new Map<string, { url: string; title: string }>();
  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    try {
      const url = researchUrl(
        new URL(
          (match[1] ?? match[2] ?? match[3]).replaceAll("&amp;", "&"),
          base,
        ).toString(),
      );
      url.hash = "";
      if (
        /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) &&
        !publicIPv4(url.hostname)
      )
        continue;
      const title = plainText(match[4]).slice(0, 160);
      if (title && url.toString() !== base)
        links.set(url.toString(), { url: url.toString(), title });
    } catch {
      /* Ignore non-HTTP, credentialed, private-literal and out-of-scope links. */
    }
    if (links.size >= 30) break;
  }
  return [...links.values()];
}
const lastRequest = new Map<string, number>();
async function robotsFor(url: URL) {
  let current = `${url.origin}/robots.txt`;
  for (let count = 0; count <= 3; count++) {
    const response = await pinnedGet(current);
    if (response.status === 404 || response.status === 410) return "";
    if (response.status >= 300 && response.status < 400 && response.location) {
      current = researchUrl(
        new URL(response.location, current).toString(),
      ).toString();
      continue;
    }
    if (response.status !== 200)
      throw new Error(
        `robots.txt unavailable (HTTP ${response.status}); try another source`,
      );
    return response.body;
  }
  throw new Error("robots.txt redirect limit reached");
}
async function fetchDirect(raw: string) {
  let url = researchUrl(raw);
  for (let count = 0; count <= 3; count++) {
    if (Date.now() - (lastRequest.get(url.hostname) ?? 0) < 5000)
      throw new Error("Research host rate limit: wait five seconds");
    lastRequest.set(url.hostname, Date.now());
    if (!robotsAllows(await robotsFor(url), url.pathname + url.search))
      throw new Error(
        "robots.txt disallows this source; choose another source",
      );
    const response = await pinnedGet(url.toString());
    if (response.status >= 300 && response.status < 400 && response.location) {
      const next = researchUrl(new URL(response.location, url).toString());
      if (next.hostname === url.hostname) lastRequest.delete(url.hostname);
      url = next;
      continue;
    }
    if (response.status !== 200)
      throw new Error(
        `Research HTTP ${response.status}; choose another source`,
      );
    const article =
      /<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i.exec(
        response.body,
      )?.[1] ?? response.body;
    return {
      url: url.toString(),
      text: plainText(article).slice(0, 14000),
      links: publicLinks(article, url.toString()),
    };
  }
  throw new Error("Research redirect limit reached");
}
export async function fetchPublic(raw: string) {
  try {
    const page = await fetchDirect(raw);
    if (page.text.trim().length >= 80 || !env.FIRECRAWL_API_KEY) return page;
    await approvedUrl(raw);
    return firecrawlRead(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      !env.FIRECRAWL_API_KEY ||
      /robots|private|scope|rate limit|cooling down|HTTP 40[13]|HTTP 429/i.test(
        message,
      )
    )
      throw error;
    const { url } = await approvedUrl(raw);
    if (!robotsAllows(await robotsFor(url), url.pathname + url.search))
      throw new Error("robots.txt disallows this source");
    return firecrawlRead(url.toString());
  }
}
export interface SearchResult {
  title: string;
  url: string;
  description: string;
  source?: string;
}
const wiki = z.object({
  query: z.object({
    search: z
      .array(z.object({ title: z.string(), snippet: z.string() }))
      .max(20),
  }),
});
const news = z.object({
  hits: z
    .array(
      z.object({
        title: z.string().nullable(),
        url: z.string().nullable(),
        objectID: z.string(),
        story_text: z.string().nullable().optional(),
      }),
    )
    .max(20),
});
export function parsePublicSearch(
  provider: "wikipedia" | "hacker-news",
  input: unknown,
): SearchResult[] {
  if (provider === "wikipedia")
    return wiki
      .parse(input)
      .query.search.slice(0, 5)
      .map((item) => ({
        title: item.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replaceAll(" ", "_"))}`,
        description: plainText(item.snippet).slice(0, 600),
        source: "Wikipedia search",
      }));
  return news
    .parse(input)
    .hits.filter((item) => item.title)
    .slice(0, 5)
    .map((item) => {
      let url = `https://news.ycombinator.com/item?id=${encodeURIComponent(item.objectID)}`;
      try {
        if (item.url && new URL(item.url).protocol === "https:") url = item.url;
      } catch {
        /* Keep the public discussion URL. */
      }
      return {
        title: item.title!,
        url,
        description: plainText(
          item.story_text ??
            "Community discussion lead; read the source and verify claims independently.",
        ).slice(0, 600),
        source: "Hacker News search",
      };
    });
}
const searchCache = new Map<
  string,
  { until: number; results: SearchResult[] }
>();
let lastSearch = 0;
export async function searchPublic(query: string) {
  query = z.string().min(2).max(300).parse(query).trim();
  const cacheKey = `${env.SEARCH_PROVIDER}:${query.toLowerCase()}`,
    cached = searchCache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.results;
  if (Date.now() - lastSearch < 5000)
    throw new Error(
      "Search rate limit: wait five seconds or read an existing source",
    );
  lastSearch = Date.now();
  let results: SearchResult[];
  if (env.SEARCH_PROVIDER === "langsearch") {
    results = await langSearch(query);
  } else if (env.SEARCH_PROVIDER === "brave") {
    if (!env.BRAVE_SEARCH_KEY)
      throw new Error(
        "Selected Brave provider has no key; select the free public provider",
      );
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        redirect: "error",
        headers: {
          "X-Subscription-Token": env.BRAVE_SEARCH_KEY,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) throw new Error(`Search HTTP ${response.status}`);
    results =
      z
        .object({
          web: z
            .object({
              results: z
                .array(
                  z.object({
                    title: z.string(),
                    url: z.string().url(),
                    description: z.string(),
                  }),
                )
                .max(20),
            })
            .optional(),
        })
        .parse(await response.json())
        .web?.results.slice(0, 5) ?? [];
  } else {
    // Documented public APIs: no API key, paid grounding, login or full-index claim.
    const searches = await Promise.allSettled([
      (async () => {
        const response = await pinnedGet(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json`,
        );
        if (response.status !== 200)
          throw new Error(`Wikipedia HTTP ${response.status}`);
        return parsePublicSearch("wikipedia", JSON.parse(response.body));
      })(),
      (async () => {
        const response = await pinnedGet(
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`,
        );
        if (response.status !== 200)
          throw new Error(`Hacker News HTTP ${response.status}`);
        return parsePublicSearch("hacker-news", JSON.parse(response.body));
      })(),
    ]);
    results = searches.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    if (searches.every((result) => result.status === "rejected"))
      throw new Error(
        "Public discovery sources are temporarily unavailable; read a known primary URL instead",
      );
  }
  searchCache.set(cacheKey, { until: Date.now() + 300000, results });
  if (searchCache.size > 100)
    searchCache.delete(searchCache.keys().next().value!);
  return results;
}
