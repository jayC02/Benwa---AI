import { useState, type FormEvent } from "react";
import type { Snapshot } from "../server/snapshot";
export default function HumanAssistance({
  items,
  busy,
  mutate,
}: {
  items: Snapshot["assistance"];
  busy: boolean;
  mutate: (endpoint: string, body: unknown) => Promise<boolean>;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  if (!items.length) return null;
  async function respond(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const reply = String(new FormData(form).get("reply"));
    if (await mutate("assistance", { id, reply })) form.reset();
  }
  return (
    <section className="approval-panel">
      <div className="section-heading">
        <h2>
          A little help from you <span className="count">{items.length}</span>
        </h2>
      </div>
      {items.map((item) => (
        <details className="assistance-item" key={item.id}>
          <summary>{item.title}</summary>
          <p>
            Copy this prompt into Codex or Claude yourself. Benwa can work on
            other projects while he waits.
          </p>
          <pre>{item.prompt}</pre>
          <button
            className="secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(item.prompt)
                .then(() => setCopyStatus("Prompt copied."))
                .catch(() =>
                  setCopyStatus(
                    "Select the prompt text above and copy it manually.",
                  ),
                );
            }}
          >
            Copy help prompt
          </button>
          {copyStatus && <p role="status">{copyStatus}</p>}
          <form
            className="settings-form"
            onSubmit={(e) => void respond(e, item.id)}
          >
            <label>
              Your reviewed guidance
              <textarea
                name="reply"
                required
                minLength={10}
                maxLength={12000}
                rows={5}
              />
            </label>
            <button className="primary" disabled={busy}>
              Save guidance and reactivate
            </button>
          </form>
        </details>
      ))}
    </section>
  );
}
