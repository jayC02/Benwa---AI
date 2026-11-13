import { afterEach, describe, expect, it } from "vitest";
import { env } from "../packages/core/src/config";
import {
  approvedUrl,
  parsePublicSearch,
  publicIPv4,
  publicLinks,
  researchUrl,
  robotsAllows,
} from "../packages/core/src/research";
const originalHosts = env.RESEARCH_HOSTS;
afterEach(() => {
  env.RESEARCH_HOSTS = originalHosts;
});
describe("Autonomous public research", () => {
  it("accepts public HTTPS scope without granting local network or credential access", async () => {
    env.RESEARCH_HOSTS = "*";
    expect(
      researchUrl("https://www.mediawiki.org/wiki/API:Search").hostname,
    ).toBe("www.mediawiki.org");
    for (const url of [
      "http://example.com",
      "file:///etc/passwd",
      "https://user:pass@example.com/",
      "https://example.com:5432/",
    ])
      expect(() => researchUrl(url)).toThrow();
    await expect(approvedUrl("https://127.0.0.1/")).rejects.toThrow("Private");
    await expect(approvedUrl("https://169.254.169.254/")).rejects.toThrow(
      "Private",
    );
    for (const ip of [
      "999.2.3.4",
      "198.51.100.1",
      "203.0.113.1",
      "192.88.99.1",
    ])
      expect(publicIPv4(ip)).toBe(false);
  });
  it("preserves restricted host configuration for existing installations", () => {
    env.RESEARCH_HOSTS = "docs.python.org";
    expect(() => researchUrl("https://docs.python.org/3/")).not.toThrow();
    expect(() => researchUrl("https://example.com/")).toThrow();
  });
  it("returns usable source links without executable or private-literal URLs", () => {
    env.RESEARCH_HOSTS = "*";
    expect(
      publicLinks(
        '<a href="/guide#section"> Guide </a><a href="https://primary.example/report?a=1&amp;b=2">Report</a><a href="javascript:alert(1)">Run</a><a href="https://127.0.0.1/">Local</a><a href="https://user:pass@primary.example/">Login</a>',
        "https://docs.example/start",
      ),
    ).toEqual([
      { url: "https://docs.example/guide", title: "Guide" },
      { url: "https://primary.example/report?a=1&b=2", title: "Report" },
    ]);
  });
  it("prefers the matching robots group and honours end markers", () => {
    const robots =
      "User-agent: *\nDisallow: /\nUser-agent: BenwaResearch\nAllow: /docs\nDisallow: /docs/private$";
    expect(robotsAllows(robots, "/docs/guide")).toBe(true);
    expect(robotsAllows(robots, "/docs/private")).toBe(false);
    expect(robotsAllows(robots, "/docs/private/public")).toBe(true);
  });
  it("validates public search responses and identifies their actual source", () => {
    expect(
      parsePublicSearch("wikipedia", {
        query: {
          search: [
            { title: "Break-even", snippet: "A <span>cost</span> calculation" },
          ],
        },
      })[0],
    ).toEqual({
      title: "Break-even",
      url: "https://en.wikipedia.org/wiki/Break-even",
      description: "A cost calculation",
      source: "Wikipedia search",
    });
    expect(
      parsePublicSearch("hacker-news", {
        hits: [
          {
            title: "Pricing tool",
            url: "http://legacy.example/",
            objectID: "123",
          },
        ],
      })[0].url,
    ).toBe("https://news.ycombinator.com/item?id=123");
    expect(() =>
      parsePublicSearch("wikipedia", { query: { search: "invalid" } }),
    ).toThrow();
  });
});
