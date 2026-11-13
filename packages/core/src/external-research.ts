import { z } from "zod";
import { createHash } from "node:crypto";
import { db } from "./db.js";
import { env } from "./config.js";

export const BrowserCheck = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fill"),
      selector: z.string().max(240),
      value: z.string().max(1000),
    })
    .strict(),
  z
    .object({ kind: z.literal("click"), selector: z.string().max(240) })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      selector: z.string().max(240),
      contains: z.string().min(1).max(1000),
    })
    .strict(),
]);
export type BrowserCheck = z.infer<typeof BrowserCheck>;
const day = () => new Date().toISOString().slice(0, 10);
const tomorrow = () =>
  new Date(new Date(`${day()}T00:00:00Z`).getTime() + 86400000);
export async function providerJson(
  provider: "langsearch" | "firecrawl",
  endpoint: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const base =
    provider === "langsearch"
      ? "https://api.langsearch.com/v1/"
      : "https://api.firecrawl.dev/v2/";
  if (!/^[a-zA-Z0-9/_-]+$/.test(endpoint))
    throw new Error("Invalid provider endpoint");
  const key =
    provider === "langsearch" ? env.LANGSEARCH_API_KEY : env.FIRECRAWL_API_KEY;
  if (!key) throw new Error(`${provider} is not configured`);
  const response = await fetch(base + endpoint, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Research provider returned no body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 1000000) {
      await reader.cancel();
      throw new Error("Research provider response exceeds size limit");
    }
    chunks.push(chunk.value);
  }
  const bytes = Buffer.concat(chunks);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString());
  } catch {
    throw new Error(`${provider} returned invalid JSON`);
  }
  if (!response.ok) {
    const seconds = Number(response.headers.get("retry-after"));
    const delay =
      response.status === 402 || /daily|TPD/i.test(JSON.stringify(value))
        ? tomorrow()
        : new Date(
            Math.max(
              Date.now() + (response.status === 429 ? 60000 : 300000),
              Number.isFinite(seconds)
                ? Date.now() + seconds * 1000
                : Date.parse(response.headers.get("retry-after") ?? "") || 0,
            ),
          );
    await db.researchUsage.upsert({
      where: { provider_period: { provider, period: day() } },
      create: {
        provider,
        period: day(),
        cooldownUntil: delay,
        error: `HTTP ${response.status}`,
      },
      update: { cooldownUntil: delay, error: `HTTP ${response.status}` },
    });
    throw new Error(
      `${provider} HTTP ${response.status}; deferred until ${delay.toISOString()}`,
    );
  }
  return value;
}
async function reserve(
  provider: string,
  period: string,
  tokens: number,
  credits: number,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
    const cooling = await tx.researchUsage.findFirst({
      where: { provider, cooldownUntil: { gt: new Date() } },
    });
    if (cooling)
      throw new Error(
        `${provider} is cooling down until ${cooling.cooldownUntil!.toISOString()}`,
      );
    const row = await tx.researchUsage.upsert({
      where: { provider_period: { provider, period } },
      create: { provider, period },
      update: {},
    });
    if (row.lastRequestAt && Date.now() - row.lastRequestAt.getTime() < 5000)
      throw new Error(`${provider}: wait five seconds before another request`);
    if (
      provider === "langsearch" &&
      row.tokens + tokens > env.LANGSEARCH_DAILY_TOKEN_LIMIT
    )
      throw new Error(
        "LangSearch local daily token ceiling reached; wait for UTC reset",
      );
    if (
      provider === "firecrawl" &&
      row.credits + credits > env.FIRECRAWL_MONTHLY_CREDIT_LIMIT
    )
      throw new Error("Firecrawl local monthly credit ceiling reached");
    return tx.researchUsage.update({
      where: { id: row.id },
      data: {
        requests: { increment: 1 },
        tokens: { increment: tokens },
        credits: { increment: credits },
        lastRequestAt: new Date(),
      },
    });
  });
}
export async function langSearch(query: string) {
  const estimated = Buffer.byteLength(query) + 16000;
  const reservation = await reserve("langsearch", day(), estimated, 0);
  const raw = await providerJson("langsearch", "web-search", {
    query,
    count: 5,
    contents: { text: { maxCharacters: 700 } },
  });
  const result = z
    .object({
      code: z.literal(200),
      data: z.object({
        webPages: z
          .object({
            value: z
              .array(
                z.object({
                  name: z.string(),
                  url: z.string().url(),
                  snippet: z.string().optional(),
                  text: z.string().optional(),
                  summary: z.string().optional(),
                }),
              )
              .max(50),
          })
          .optional(),
      }),
      usage: z.object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
      }),
    })
    .parse(raw);
  const used = result.usage.input_tokens + result.usage.output_tokens;
  await db.researchUsage.update({
    where: { id: reservation.id },
    data: { tokens: { increment: used - estimated } },
  });
  return (result.data.webPages?.value ?? [])
    .slice(0, 5)
    .filter((row) => {
      try {
        const u = new URL(row.url);
        return u.protocol === "https:" && !u.username && !u.password;
      } catch {
        return false;
      }
    })
    .map((row) => ({
      title: row.name.slice(0, 300),
      url: row.url,
      description: (row.text ?? row.snippet ?? row.summary ?? "").slice(
        0,
        1400,
      ),
      source: "LangSearch web search",
    }));
}
const Credits = z.object({
  success: z.literal(true),
  data: z.object({
    remainingCredits: z.number().nonnegative(),
    planCredits: z.number().nonnegative(),
    billingPeriodStart: z.string(),
    billingPeriodEnd: z.string(),
  }),
});
export async function firecrawlFreeCredits() {
  const status = Credits.parse(
    await providerJson("firecrawl", "team/credit-usage"),
  ).data;
  // The documented free plan has 1,000 monthly credits. Never activate a paid plan/top-up.
  if (status.planCredits !== 1000)
    throw new Error(
      "Firecrawl plan is not the confirmed 1,000-credit free tier; operation blocked",
    );
  return status;
}
async function reserveFirecrawl(credits: number) {
  const status = await firecrawlFreeCredits();
  if (status.remainingCredits < credits)
    throw new Error("Firecrawl free credits exhausted");
  await reserve("firecrawl", status.billingPeriodStart, 0, credits);
}
export async function firecrawlRead(url: string) {
  await reserveFirecrawl(1);
  const result = z
    .object({
      success: z.literal(true),
      data: z.object({
        markdown: z.string().max(500000),
        metadata: z
          .object({
            sourceURL: z.string().optional(),
            statusCode: z.number().optional(),
          })
          .optional(),
      }),
    })
    .parse(
      await providerJson("firecrawl", "scrape", {
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        parsers: [],
        proxy: "basic",
        timeout: 15000,
      }),
    );
  if (
    result.data.metadata?.statusCode &&
    result.data.metadata.statusCode !== 200
  )
    throw new Error("Firecrawl source did not return HTTP 200");
  return {
    url,
    text: result.data.markdown.slice(0, 14000),
    links: [] as { title: string; url: string }[],
    reader: "Firecrawl",
  };
}
export async function firecrawlBrowserTest(
  html: string,
  checks: BrowserCheck[] = [],
) {
  if (!env.FIRECRAWL_BROWSER_TESTS_ALLOWED)
    throw new Error(
      "Remote browser tests require the operator's permission to send generated HTML to Firecrawl",
    );
  if (Buffer.byteLength(html) > 80000)
    throw new Error("Remote browser test artifact exceeds limit");
  const parsedChecks = z.array(BrowserCheck).max(20).parse(checks);
  if (
    /<form\b|<button\b/i.test(html) &&
    !parsedChecks.some((check) => check.kind === "text")
  )
    return {
      code: 1,
      stdout:
        "Interactive artifacts require functional checks, including an expected text result. A screenshot alone cannot pass TESTING.",
      stderr: "",
      inspection: "browser",
      assertions: 0,
    };
  await reserveFirecrawl(4); // Reserve conservatively for a bounded <=60-second code-only session.
  const session = z
    .object({
      success: z.literal(true),
      id: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
    })
    .parse(
      await providerJson("firecrawl", "interact", {
        ttl: 60,
        activityTtl: 60,
        streamWebView: false,
      }),
    );
  try {
    const code = `const errors=[]; page.on('pageerror',e=>errors.push(String(e.message).slice(0,300))); await page.route('**/*',r=>r.abort());
const html=${JSON.stringify(html)}; const policy='<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;unsafe-inline&apos;; style-src &apos;unsafe-inline&apos;; img-src data:; connect-src &apos;none&apos;; form-action &apos;none&apos;">';
await page.setContent(/<head[^a-zA-Z]/i.test(html)?html.replace(/<head[^>]*>/i,m=>m+policy):policy+html,{waitUntil:'domcontentloaded',timeout:5000});
const checks=${JSON.stringify(parsedChecks)}; let assertions=0;
try { for (const check of checks) { const el=page.locator(check.selector).first(); if(check.kind==='fill') await el.fill(check.value,{timeout:3000}); if(check.kind==='click') await el.click({timeout:3000}); if(check.kind==='text'){ const text=await el.innerText({timeout:3000}); if(!text.includes(check.contains)) throw new Error('Expected result missing at '+check.selector); assertions++; } } } catch(e){errors.push(String(e.message).slice(0,500));}
const shot=await page.screenshot(); console.log(JSON.stringify({benwaBrowser:true,passed:errors.length===0,assertions,errors,screenshotBase64:shot.toString('base64')}));`;
    const execution = z
      .object({
        success: z.boolean(),
        stdout: z.string().nullable().optional(),
        result: z.string().nullable().optional(),
        error: z.string().optional(),
        stderr: z.string().nullable().optional(),
        exitCode: z.number().optional(),
      })
      .parse(
        await providerJson("firecrawl", `interact/${session.id}/execute`, {
          code,
          language: "node",
          timeout: 20,
        }),
      );
    if (
      !execution.success ||
      execution.error ||
      (execution.exitCode !== undefined && execution.exitCode !== 0)
    )
      throw new Error(
        `Remote browser execution failed; no passing evidence recorded: ${(execution.error ?? execution.stderr ?? "unknown execution error").slice(0, 600)}`,
      );
    const line = (execution.stdout ?? execution.result ?? "")
      .split("\n")
      .find((line) => line.includes('"benwaBrowser":true'));
    const result = z
      .object({
        benwaBrowser: z.literal(true),
        passed: z.boolean(),
        assertions: z.number().int().nonnegative(),
        errors: z.array(z.string()).max(30),
        screenshotBase64: z
          .string()
          .min(1)
          .max(900000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .parse(JSON.parse(line ?? "null"));
    return {
      code: result.passed ? 0 : 1,
      stdout: JSON.stringify({
        passed: result.passed,
        assertions: result.assertions,
        errors: result.errors,
      }),
      stderr: result.errors.join("\n"),
      inspection: "browser",
      assertions: result.assertions,
      screenshotHash: createHash("sha256")
        .update(Buffer.from(result.screenshotBase64, "base64"))
        .digest("hex"),
      runtime: "Firecrawl isolated browser",
    };
  } finally {
    await providerJson(
      "firecrawl",
      `interact/${session.id}`,
      undefined,
      "DELETE",
    ).catch(() => {});
    // Provider TTL is a second bound even if cleanup cannot reach the service.
  }
}
