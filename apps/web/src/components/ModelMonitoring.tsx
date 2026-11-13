import type { Snapshot } from "../server/snapshot";
export default function ModelMonitoring({
  models,
}: {
  models: Snapshot["models"];
}) {
  return (
    <section className="wide-panel">
      <h2>Model routing</h2>
      <div className="provider-details">
        <div>
          <span>Current model</span>
          <strong>{models.currentModel ?? "No inference running"}</strong>
        </div>
        <div>
          <span>Last model used</span>
          <strong>{models.lastModel ?? "None yet"}</strong>
        </div>
        <div>
          <span>Inference project check</span>
          <strong>
            {models.freeProjectConfirmed
              ? "Operator confirmed unbilled Free tier"
              : "Inference blocked until confirmed"}
          </strong>
        </div>
      </div>
      {models.lastReason && <p>{models.lastReason}</p>}
      <p>
        {models.quotaLabel} Allowances are project scoped. Shared group limits
        also apply; model allowances are not simply added together.
      </p>
      <div className="model-table-wrap">
        <table className="model-table">
          <caption>
            Local model usage · Google quota days reset at midnight Pacific time
          </caption>
          <thead>
            <tr>
              <th scope="col">Model / access</th>
              <th scope="col">Today / configured RPD</th>
              <th scope="col">Locally remaining</th>
              <th scope="col">RPM / input TPM</th>
              <th scope="col">Failures / 429</th>
              <th scope="col">Cooldown</th>
            </tr>
          </thead>
          <tbody>
            {models.models.map((m) => (
              <tr key={m.id}>
                <th scope="row">
                  <strong>{m.label}</strong>
                  <small>
                    {m.status.toLowerCase().replaceAll("_", " ")}
                    {m.reserve
                      ? ` · ${m.reserve} requests reserved for important work`
                      : ""}
                  </small>
                  <small>{m.routingUse}</small>
                  <details>
                    <summary>Usage and capabilities</summary>
                    <p>{m.note ?? m.capabilities.join(", ")}</p>
                    {m.accessError && <p>{m.accessError}</p>}
                    <p>
                      All-time observed: {m.totalRequests} requests,{" "}
                      {m.totalInputTokens} input tokens, {m.totalOutputTokens}{" "}
                      output/thinking tokens.
                    </p>
                  </details>
                </th>
                <td>
                  {m.requestsToday} / {m.limits.rpd}
                </td>
                <td>{m.remainingDaily}</td>
                <td>
                  {m.requestsPerMinute} / {m.inputPerMinute}
                </td>
                <td>
                  {m.failedRequests} / {m.rateLimitFailures}
                </td>
                <td>
                  {m.cooldownUntil ? (
                    <>
                      <time>
                        {new Date(m.cooldownUntil).toLocaleTimeString("en-GB")}
                      </time>
                      <small>{m.cooldownReason}</small>
                    </>
                  ) : m.status === "READY" ? (
                    "No active cooldown"
                  ) : (
                    "Inference not enabled"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
