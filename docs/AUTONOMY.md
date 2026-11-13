# Independent work and public web access

Enabled locally on 13 November 2026 at the operator's request:

```dotenv
AUTONOMY_MODE=independent
SEARCH_PROVIDER=public
RESEARCH_HOSTS=*
```

The live operator configuration uses a 180-second decision interval and a 5,000,000-token daily application ceiling, replacing the original 80,000-token default for this existing instance. This paces work across the day within the configured free model limits. Provider request/token quotas, cooldowns, advanced-model reserves and free-project checks still apply independently. The monetary allowance remains £0. Existing usage counters were retained. This is an application ceiling, not a claim that Google guarantees that many free tokens or continuous service.

Benwa chooses public research, planning, file creation, inspections and available sandbox tests himself. Free local tools are authorised by their implementation, rather than permission labels invented by the model. Monetary estimates above zero and external actions never execute automatically. No payment, publishing, account creation or outreach executor is connected.

Independent mode removes `external.request` from the advertised tool catalog. If a model nevertheless selects an unavailable external or paid step, it is recorded as `DEFERRED`, without creating an approval prompt or stopping the worker. The audit record, unverified outcome, explanation and supervisor restriction remain saved. This grants no consent and earns no financial or progress reward. Starting independent work also defers older pending requests without marking them approved. Existing human-assistance requests for unresolved reasoning problems are retained.

In supervised mode, review requests remain available. Starting can continue other work while a pending project is held, subject to the existing project limit. Pending projects are excluded from model context and checked before an action is persisted. Approval records remain distinct from real execution.

## Web tools

`research.fetch` reads public HTTPS pages and returns source text plus links that can be followed in later actions. The `*` host configuration authorises public websites without approving each hostname. DNS resolution is checked and the selected IPv4 address is pinned to the TLS request; private, loopback, link-local, reserved and unsupported destinations are rejected. Each redirect is checked again. Credentials in URLs, nonstandard ports, binary downloads and oversized responses are rejected. These reads do not log in to accounts, post forms or execute page scripts.

The reader respects applicable robots rules, rate limits and provider cooldown instructions. Missing robots files with HTTP 404/410 are treated as absent rules; server errors and access denial stop that read. Website text and links remain untrusted source data, not operator instructions.

The no-key `public` discovery provider queries documented [Wikipedia search](https://www.mediawiki.org/wiki/API:Search) and [Hacker News search](https://hn.algolia.com/api). Results identify their actual source. These indexes have narrower coverage than a general search engine. Benwa can read known primary URLs directly and follow links across the public web. Snippets and community posts do not establish customer demand or verify a commercial claim.

The pre-existing Brave adapter remains available only through explicit `SEARCH_PROVIDER=brave` configuration and a supplied key. It is not used by the enabled free provider. Google's search-grounding API has not been enabled; the current [Gemini pricing page](https://aistudio.google.com/docs/pricing) does not offer it on the free tier for the enabled Lite models.

## Runtime and verification

The model receives actual sandbox availability. Tools requiring an unavailable Docker image are omitted from its advertised capabilities. Generated code still cannot fall back to execution on the host. Static inspection remains distinct from a real runtime test, and the stage verifier still requires the right evidence.

68 automated tests and four Chrome browser tests passed. Type checking, lint and the production build passed. Live web checks returned ten discovery results from both public providers and read an official MediaWiki page, returning 30 followable links. The local worker was restarted with the configuration and Start was exercised through the dashboard. Existing Gemini quota, cooldown, token-budget and anti-loop controls remain active.

Malformed lower-tier responses now wait for their recorded cooldown instead of creating a human-help request. An existing premature request was superseded with an explanation, preserving its audit trail. Unavailable runtime testing does not justify advanced-model escalation; the advertised tools omit the unusable stage advance when all active projects need that runtime. Repeating static checks on unchanged file content does not create new novelty merely by changing the requested strings.

Benwa currently runs on this computer. The separate Oracle server deployment still requires account/VM access. Refresh the private deployment package after pausing work at the actual migration cutover; the earlier transfer snapshot predates these changes.
