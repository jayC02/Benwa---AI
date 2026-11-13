# Verification — 12 November 2026

Run on Windows with Node.js 24.16.0. No LLM, search, payment or deployment credentials were supplied. Docker was not installed.

| Check                                        | Result                                                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                   | 29 tests passed, using isolated PostgreSQL and real filesystem output                                                                                           |
| HTTP model adapter test                      | Actual local HTTP function-call request, Zod parsing, token accounting, tool execution and persisted verification passed                                        |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` | 2 tests passed against installed Chrome; desktop/mobile, model load, saved settings, origin checks and fabricated finance rejection                             |
| `npm run typecheck`                          | TypeScript and Astro: zero errors, warnings or hints                                                                                                            |
| `npm run lint`                               | Passed                                                                                                                                                          |
| `npm run build`                              | Passed; Three.js produces a vendor chunk size advisory                                                                                                          |
| `npm audit`                                  | Zero known vulnerabilities                                                                                                                                      |
| `npm run dev`                                | Applied migrations, preserved state and started independent worker and dashboard; supervisor startup is included                                                |
| Independent supervisor                       | Separate process heartbeat observed in the dashboard; time/cost suspension and cross-project review covered by tests                                            |
| Compiled `npm start`                         | HTTP 200 dashboard/state/model, persisted name Benwa, 12 actions, 1 project, WAITING_APPROVAL, verified revenue 0, supplied model 271,196 bytes and live canvas |
| Full demo workflow                           | Persisted source fixture clearly labelled; real plan, validation brief, calculator HTML and static inspection; stopped for human review                         |
| Restart                                      | Browser reloads and worker stop/restart preserved project, actions, memories and review request                                                                 |
| `npm run smoke:real`                         | Explicit missing-credentials skip, before any model call                                                                                                        |
| Docker sandbox / Compose                     | Implemented and documented; execution not verified because Docker is unavailable                                                                                |
| Public launch / outreach / spending          | Disabled; no external executor or transaction was performed                                                                                                     |

The real-provider smoke command is a bounded, operator-configured check; a successful local HTTP fixture is not a claim that a live model or live research endpoint was tested. File read-back and static checks do not certify software correctness, customer demand, or commercial value. No revenue was fabricated or seeded. API cost totals include recorded invoices only.

Screenshots: `artifacts/desktop.png` and `artifacts/mobile.png`. Detailed dependency audit: `artifacts/dependency-audit.json`. These are local ignored artifacts. The development database and generated calculator are preserved under `.data/`.

## Subsequent Gemini upgrade

The operator supplied a local API key and confirmed its Google project is unbilled and on the Free tier. The official `@google/genai` SDK was added behind the existing provider interface. All thirteen documented model IDs returned metadata. Actual bounded probes passed for Gemini 3.1 Flash-Lite and Hydrogen (structured actions), plus both Gemma 4 variants (plain text only). Three Flash variants returned temporary 503s, Gemini 3 Flash produced an invalid JSON tool input, and the legacy 2.5 pair returned 404. Decision and Embedding operations remain disabled pending operation-specific configuration. Full details and official references are in [GEMINI.md](GEMINI.md).

Upgrade verification: **50 engine/integration tests**, **3 browser tests**, strict TypeScript/Astro checks and lint passed. The updated dependency audit contains zero known advisories. Tests include model routing, shared and individual quotas, atomic reservation/settlement, 429 fallback, protected advanced allowance, free-project guards, key changes, Pacific resets, deferred cycles, Gemma text-only operation and human assistance. Live model probes are separate from the automated suite. The existing daily token cap and unknown-call reservations were preserved. The creature environment, emotions, projects, memories and financial entries were not reset.
