import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { once } from "node:events";
import { repoRoot } from "../packages/core/src/config.js";

// Build with BENWA_PUBLIC_HOST=benwa-deployment.test before running this check.
// All requests go to loopback; no credentials or data leave this computer.
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const address = listener.address();
if (!address || typeof address === "string")
  throw new Error("Missing test port");
await new Promise<void>((resolve) => listener.close(() => resolve()));
const password = randomBytes(24).toString("hex");
const server = spawn(
  process.execPath,
  [process.env.BENWA_VERIFY_ENTRY ?? "apps/web/dist/server/entry.mjs"],
  {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(address.port),
      DASHBOARD_PASSWORD: password,
      SESSION_SECRET: randomBytes(48).toString("hex"),
    },
  },
);
server.on("error", (error) => {
  console.error(error.message);
});
let serverError = "";
server.stderr?.on("data", (data: Buffer) => {
  serverError = (serverError + data.toString()).slice(-6000);
});
const origin = "https://benwa-deployment.test";
const url = `http://127.0.0.1:${address.port}`;
const headers = {
  host: "benwa-deployment.test",
  "x-forwarded-host": "benwa-deployment.test",
  "x-forwarded-proto": "https",
  "x-forwarded-port": "443",
};
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      ready = (await fetch(`${url}/login`, { headers })).ok;
    } catch {
      /* Wait for our server only. */
    }
    if (ready) break;
    if (server.exitCode !== null)
      throw new Error(
        `Production server exited before startup: ${serverError}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "Production server did not become ready");
  assert.equal((await fetch(`${url}/api/state`, { headers })).status, 401);
  const login = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { ...headers, origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(
    login.status,
    200,
    "HTTPS proxy login must pass origin validation",
  );
  const cookie = login.headers.get("set-cookie");
  assert(cookie?.includes("Secure"), "Proxy login must issue a Secure cookie");
  assert(cookie?.includes("HttpOnly"));
  assert(cookie?.includes("SameSite=Strict"));
  const authenticated = { ...headers, cookie: cookie!.split(";")[0] };
  assert.equal(
    (await fetch(`${url}/api/state`, { headers: authenticated })).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${url}/api/control`, {
        method: "POST",
        headers: {
          ...authenticated,
          origin: "https://untrusted.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command: "pause" }),
      })
    ).status,
    403,
  );
  // An invalid command reaches Zod without changing the live creature's state.
  assert.equal(
    (
      await fetch(`${url}/api/control`, {
        method: "POST",
        headers: {
          ...authenticated,
          origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command: "invalid-test-command" }),
      })
    ).status,
    400,
  );
  console.log(
    "Production proxy checks passed: login, Secure/HttpOnly cookie, authenticated state, origin rejection and validated controls. No model calls or state changes.",
  );
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit").catch(() => {});
    server.kill();
    await exited;
  }
}
