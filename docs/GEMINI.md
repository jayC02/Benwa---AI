# Gemini routing upgrade

This extends Benwa's existing `Provider.decide` interface. The creature, tools, goals, project lifecycle, emotional rules, financial ledger and 3D environment are retained. The existing OpenAI-compatible adapter and demo provider still work when explicitly selected. Gemini routing never falls back to them.

## Configuration

Store credentials only in the ignored root `.env`:

```dotenv
LLM_PROVIDER=gemini
AGENT_MODE=real
GEMINI_API_KEY=your-key
GEMINI_PROJECT_ID=your-google-project-id
GEMINI_FREE_TIER_PROJECT_CONFIRMED=true
GEMINI_EXPERIMENTAL_GEMMA=false
GEMINI_QUOTAS_JSON={}
```

Only set the confirmation flag after verifying that **this key belongs to a dedicated, unbilled Free-tier Google project**. A model with a free tier can still be billed on a paid project. The SDK does not expose a reliable billing-status certification or a “never bill this request” switch. The router therefore fails closed until the operator confirms the project, uses reviewed standard inference only, and never enables billing, paid models, Vertex AI, grounding, caches, batch, priority inference, extra projects, or additional keys. Keep billing disabled in Google AI Studio. The model cannot change these settings. See Google's [billing documentation](https://aistudio.google.com/docs/billing).

Quota accounting is keyed by project ID, not key. Rotating a key does not replenish local allowances and requires access re-verification. Existing access probes expire after seven days. Use the same project ID and database in every worker using this quota pool. External applications using the same project are not visible locally.

```text
npm run db:generate
npm run db:migrate
npm run models:verify
npm run models:verify -- --probe --models=gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash,gemini-3.6-flash,gemini-4-hydrogen
```

Stop web/worker processes before generating Prisma on Windows. Metadata checks do not enable inference. The explicit probe command makes at most one inference attempt per selected generation model, with a synthetic project present in its context and **no execution tools**. Only models that return a valid action envelope and token usage become eligible for decisions. Known transient failures and stale access can be rechecked automatically with backoff, subject to quota and the per-cycle attempt bound. New IDs, denied access and specialized models are not silently enabled. SDK automatic retries are disabled; each inference request first reserves durable quota and Benwa's existing daily token budget.

## Confirmed IDs and live results

Official model IDs and standard free-tier eligibility were checked on **12 November 2026**; targeted action-model probes were repeated on **13 November 2026**. The following live results use the supplied key and the operator's confirmation of an unbilled project. Metadata access succeeded for all thirteen IDs. Metadata availability is not treated as a working inference test.

| Model                 | API ID                   | Live result for this project                                           |
| --------------------- | ------------------------ | ---------------------------------------------------------------------- |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite`  | Temporary HTTP 503; unverified and excluded pending a successful probe |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite`  | Structured action probe passed                                         |
| Gemini 3.8 Flash      | `gemini-3.8-flash`       | Temporary HTTP 503; excluded pending verification                      |
| Gemini 3.6 Flash      | `gemini-3.6-flash`       | Structured action probe passed on 13 November; available for routing   |
| Gemini 4 Hydrogen     | `gemini-4-hydrogen`      | Structured action probe passed                                         |
| Gemini 3 Flash        | `gemini-3-flash-preview` | Structured action probe passed on 13 November; available for routing   |
| Gemini 2.5 Flash      | `gemini-2.5-flash`       | Inference returned HTTP 404 with this key                              |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite`  | Inference returned HTTP 404 with this key                              |
| Gemma 4 26B A4B       | `gemma-4-26b-a4b-it`     | Plain-text probe passed; agent decisions excluded                      |
| Gemma 4 31B           | `gemma-4-31b-it`         | Plain-text probe passed; agent decisions excluded                      |
| Gemini Decision 1     | `gemini-decision-1`      | Metadata accessible; specialized operation remains disabled            |
| Gemini Embedding 1    | `gemini-embedding-001`   | Metadata accessible; embedding traffic remains disabled                |
| Gemini Embedding 2    | `gemini-embedding-2`     | Metadata accessible; embedding traffic remains disabled                |

Google's [model catalogue](https://aistudio.google.com/docs/models) confirms the Gemini IDs and documents restricted legacy 2.5 access. The 2.5 Flash ID is disabled in Benwa from 1 December 2026, before Google's documented automatic remapping to a different model. The hosted [Gemma API guide](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) confirms both Gemma IDs and function calling; equivalent structured-output behavior is not assumed. Standard inference free-tier entries are documented in [Google's pricing table](https://aistudio.google.com/docs/pricing). Application limits below come from the operator's supplied dashboard, not a promise from Google.

## Selection and escalation

The central catalog is `packages/core/src/gemini/catalog.ts`; task classification/ranking is in `policy.ts`. Routine action selection uses Lite models. Planning, code work and testing prefer intermediate Flash models. Explicit complex objectives, or repeated reasoning/test failures after supervisor intervention, can justify Hydrogen. A single failed action, missing Docker, missing credentials, permissions, timeouts and quota errors do not justify advanced reasoning.

The router checks required capabilities, verified access, task complexity, recent structured-output performance, configured request/token allowance, active cooldowns and estimated prompt size. It prefers the strongest suitable tier only when the task warrants it; routine tasks never consume Hydrogen as a convenience fallback. Five of Hydrogen's configured daily requests are reserved for important work. Intermediate work can use a verified Lite model if the preferred Flash models are unavailable. Routine work tries eligible Lite models first, then can fall back to a verified Flash model when Lite is cooling down, exhausted or returns invalid output. The reason explicitly records this fallback. There are at most three inference attempts per decision cycle, including at most one automatic capability probe, and no recursive prompt chain. Performance uses up to twenty recent successful/invalid action responses per model, excluding synthetic probes. Every selection reason is recorded.

Gemini gets the existing action envelope through a required `choose_action` function call. The wire instructions explicitly require exactly one existing/new project choice and valid JSON-encoded tool input. The adapter restores the object and applies the existing Zod validations before any tool can execute. Invalid JSON is rejected, never evaluated as code or repaired with an unsafe parser. Diagnostics record schema paths/codes or an output-token-limit condition without saving raw malformed content or private reasoning. Capability probes and routine Flash fallback use each model's documented minimum thinking level, configured in the central catalog; advanced task reasoning is preserved. [Google thinking levels](https://aistudio.google.com/docs/thinking#thinking-levels). Model changes do not replace the project, objective, memory or current durable cycle.

Transient setup failures are no longer excluded indefinitely. One previously checked model can be reverified per decision, after at least fifteen minutes and with exponentially increasing delays up to six hours. Automatic inference probes stop after four consecutive failed probes; explicit operator verification can reconsider the model later. Active model and shared cooldowns always take precedence. A previously verified model retains its capability record after a temporary outage and stays in cooldown. HTTP 503/504 are labelled temporary provider failures, rather than presented as proof of shared quota exhaustion. Authentication/access denials remain excluded.

Advanced diagnosis that fails to produce a usable result can create a persistent `HumanAssistanceRequest`. The prompt includes the objective, observed failures, attempted actions and models, requested work, success checks and permissions. Copy it into Codex or Claude manually; Benwa never connects to personal accounts. Only the affected project enters `WAITING_ASSISTANCE`; other active projects continue. Save reviewed guidance in the existing dashboard to reactivate the project. Resolved requests remain auditable and repeated open requests are deduplicated.

## Quotas, shared limits and retries

Each model starts with the RPM, input TPM and RPD supplied in the request. Every reservation is atomic across workers under PostgreSQL locking. Counts include probes and failed/ambiguous inference attempts. Successful usage replaces the token reservation with returned input and output/thinking usage; unknown usage remains conservatively reserved. Interrupted reservations survive restarts. A settlement is applied exactly once even if completion callbacks race.

Minute limits use rolling sixty-second windows. Google RPD accounting uses midnight **America/Los_Angeles**, including daylight saving changes. Benwa's separate existing daily token safety budget still resets at **00:00 UTC**. This budget is not increased or reset to bypass failed probes. The live probes left substantial conservative reservations from 503/404/invalid responses; a task may safely defer until the next token-budget period even if its model's local RPD allowance remains.

Provider `Retry-After`, `RetryInfo`, quota scope and daily-limit signals determine cooldowns. A model-scoped quota failure can use another suitable verified model. Shared or unclassified quota failures block the common generation pool. Google [documents project-scoped quotas and Pacific resets](https://aistudio.google.com/docs/rate-limits). Built-in tools with separate/shared quotas are disabled, so their allowances are never added to inference capacity.

In addition to individual model limits, conservative application groups enforce a generation-project ceiling of 15 RPM / 250K input TPM / 500 RPD and a shared Gemma-family ceiling of 30 RPM / 16K input TPM / 14,400 RPD. These are **local safety ceilings, not independently verified provider allowances**. They deliberately avoid adding every model's maximum together. Decisions and embeddings have zero configured quota until the operator supplies verified limits. All groups and model caps can be configured centrally:

```dotenv
GEMINI_QUOTAS_JSON={"models":{"gemini-3.1-flash-lite":{"rpm":10,"tpm":200000,"rpd":400}},"groups":{"generation-project":{"rpm":10,"tpm":200000,"rpd":400}}}
```

Only reviewed model IDs and known group names are accepted. An override cannot enable a paid model or change a capability. Do not increase shared ceilings without checking the actual project limits in AI Studio. When no suitable quota remains, the same saved cycle is scheduled for later with `QUOTA_PAUSED`; no progress or emotion reward is fabricated.

## Experimental and specialized models

Evaluate plain-text Gemma explicitly with:

```text
npm run models:verify -- --probe --experimental --models=gemma-4-26b-a4b-it,gemma-4-31b-it
```

After a successful probe, `GEMINI_EXPERIMENTAL_GEMMA=true` allows optional, short plain-text summaries during memory consolidation. These are stored separately as unverified beliefs. The existing deterministic self-model and full history remain authoritative. Gemma receives no agent tool schema in this path. Summaries use the same durable quotas/budget and cannot block rest/wake when unavailable.

[Decision 1](https://aistudio.google.com/docs/decisions-api) produces calibrated yes/no, choice or rubric judgments through a dedicated endpoint, not Benwa's action object. It is evaluated in the registry but not substituted for the supervisor or action chooser. [Embedding 1](https://aistudio.google.com/docs/models/gemini-embedding-001) and [Embedding 2](https://aistudio.google.com/docs/models/gemini-embedding-2) support different inputs/context sizes and embedding spaces. Their free-tier text operations are documented, but quotas were not supplied and no live embedding probe was made. They remain disabled; existing retrieval is preserved without silently mixing vector spaces or sending memories for embedding.

## Monitoring and validation

The existing Settings page now shows current/last model, selection reason, locally observed usage, configured remaining daily allowance, failures, 429 counts, token totals and cooldowns. It explicitly does not claim Google-confirmed remaining quota. The help queue appears in the existing Home sidebar only when requests exist. The creature and environment are unchanged.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. The regression suite includes deterministic transports for routing, shared quotas, 429 fallback, protected advanced requests, actual token settlement, key changes, paid-mode guards, model capability exclusions, Pacific resets, deferred durable cycles and human assistance. Live capability probes are separate and never run as part of `npm test`.
