import { describe, it, expect } from "vitest";
import { simulate, defaultWeights } from "../packages/core/src/simulation";
import {
  assessRepetition,
  fingerprint,
  verifyResult,
  permissionCheck,
} from "../packages/core/src/supervisor";
import { publicIPv4, robotsAllows } from "../packages/core/src/research";
import { verifyStripeSignature } from "../packages/core/src/finance";
import { createHmac } from "node:crypto";
const initial = {
  mood: 50,
  energy: 50,
  curiosity: 50,
  boredom: 30,
  confidence: 50,
  frustration: 20,
};
describe("Independent emotional simulation", () => {
  it("rewards verified net profit and the first profitable sale", () => {
    expect(
      simulate(initial, { kind: "financial", netMinor: 5000n, firstSale: true })
        .mood,
    ).toBeGreaterThan(65);
  });
  it("penalises realised financial losses", () => {
    expect(
      simulate(initial, {
        kind: "financial",
        netMinor: -5000n,
        firstSale: false,
      }).mood,
    ).toBeLessThan(50);
  });
  it("keeps the repetition penalty at five times the discovery reward", () => {
    expect(Math.abs(defaultWeights.repetition)).toBe(
      defaultWeights.discovery * 5,
    );
    expect(simulate(initial, { kind: "repetition" }).mood).toBe(40);
  });
  it("bounds rewards for enormous payments", () => {
    expect(
      simulate(initial, {
        kind: "financial",
        netMinor: 10n ** 30n,
        firstSale: false,
      }).mood,
    ).toBeLessThanOrEqual(62);
  });
  it("rest restores energy with elapsed time without granting mood rewards", () => {
    expect(simulate(initial, { kind: "rest", seconds: 0 })).toEqual(initial);
    const rested = simulate(initial, { kind: "rest", seconds: 120 });
    expect(rested.energy).toBe(70);
    expect(rested.mood).toBe(50);
  });
  it("work consumes energy gradually", () => {
    expect(simulate(initial, { kind: "work", effort: 4 }).energy).toBe(46);
  });
});
describe("Deterministic anti-loop supervisor", () => {
  const action = {
    tool: "research.search",
    target: "demand maker calculator",
    intention: "Find evidence of demand for a maker calculator",
    strategy: "public-demand-research",
  } as const;
  const record = {
    ...action,
    fingerprint: fingerprint(action),
    meaningful: false,
    failed: false,
  };
  it("warns on repetition and blocks after three stagnant attempts", () => {
    expect(assessRepetition(action, [record]).level).toBe(1);
    expect(assessRepetition(action, [record, record, record]).blocked).toBe(
      true,
    );
  });
  it("allows objectively productive repetition", () => {
    expect(
      assessRepetition(action, [
        { ...record, meaningful: true },
        record,
        record,
      ]).level,
    ).toBe(0);
  });
  it("catches cosmetic query changes through intention similarity", () => {
    expect(
      assessRepetition(
        {
          ...action,
          target: "another search query",
          strategy: "different label",
        },
        [record, record, record],
      ).blocked,
    ).toBe(true);
  });
  it("does not reward the same source again under another URL", () => {
    const result = {
      kind: "source" as const,
      summary: "Read",
      evidence: { url: "https://a.invalid", contentHash: "same-bytes" },
      success: true,
      simulated: false,
    };
    const first = verifyResult(result, new Set());
    const second = verifyResult(
      { ...result, evidence: { ...result.evidence, url: "https://b.invalid" } },
      new Set([first.evidenceHash]),
    );
    expect(second.meaningful).toBe(false);
  });
  it("denies unauthorised spending and consequential external tools", () => {
    expect(
      permissionCheck({
        tool: "workspace.write",
        costEstimateMinor: 1,
        permissions: ["local"],
      }).allowed,
    ).toBe(false);
    expect(
      permissionCheck({
        tool: "external.request",
        costEstimateMinor: 0,
        permissions: [],
      }).allowed,
    ).toBe(false);
  });
  it("authorises zero-cost local tests and public reads by their actual tool", () => {
    expect(
      permissionCheck({
        tool: "browser.test",
        costEstimateMinor: 0,
        permissions: ["browser"],
      }).allowed,
    ).toBe(true);
    expect(
      permissionCheck({
        tool: "research.fetch",
        costEstimateMinor: 0,
        permissions: ["internet"],
      }).allowed,
    ).toBe(true);
    expect(
      permissionCheck({
        tool: "external.request",
        costEstimateMinor: 0,
        permissions: ["local"],
      }).allowed,
    ).toBe(false);
  });
});
describe("Source and payment trust boundaries", () => {
  it("rejects private, link-local and reserved destinations", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.1.1",
      "192.168.2.1",
      "169.254.169.254",
      "100.64.1.2",
      "::1",
      "224.1.1.1",
    ])
      expect(publicIPv4(ip)).toBe(false);
    expect(publicIPv4("8.8.8.8")).toBe(true);
  });
  it("enforces robots disallow rules and specific allow exceptions", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/public";
    expect(robotsAllows(robots, "/private/report")).toBe(false);
    expect(robotsAllows(robots, "/private/public/page")).toBe(true);
  });
  it("verifies signed webhooks and rejects tampering and old events", () => {
    const now = Date.now(),
      t = Math.floor(now / 1000),
      body = '{"livemode":true}',
      secret = "test-secret";
    const sig = createHmac("sha256", secret)
      .update(`${t}.${body}`)
      .digest("hex");
    expect(() =>
      verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, now),
    ).not.toThrow();
    expect(() =>
      verifyStripeSignature("tamper", `t=${t},v1=${sig}`, secret, now),
    ).toThrow();
    expect(() =>
      verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, now + 600000),
    ).toThrow();
  });
});
