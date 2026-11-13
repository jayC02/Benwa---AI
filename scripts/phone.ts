import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import assert from "node:assert/strict";
import { once } from "node:events";
import { z } from "zod";
import { repoRoot } from "../packages/core/src/config.js";

const directory = path.join(repoRoot, ".data", "phone");
const origin = "http://127.0.0.1:4341";
const controlOrigin = "http://127.0.0.1:4342";
const Credentials = z.object({
  password: z.string().min(24),
  sessionSecret: z.string().min(64),
  controlToken: z.string().min(64),
});
await fs.mkdir(directory, { recursive: true });
const credentialsFile = path.join(directory, "credentials.json");
try {
  await fs.writeFile(
    credentialsFile,
    JSON.stringify({
      password: randomBytes(24).toString("base64url"),
      sessionSecret: randomBytes(48).toString("hex"),
      controlToken: randomBytes(32).toString("hex"),
    }),
    { flag: "wx", mode: 0o600 },
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}
const credentials = Credentials.parse(
  JSON.parse(await fs.readFile(credentialsFile, "utf8")),
);

if (process.argv[2] === "stop") {
  const response = await fetch(`${controlOrigin}/stop`, {
    method: "POST",
    headers: { authorization: `Bearer ${credentials.controlToken}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error("Phone access did not accept the stop request");
  console.log(
    "Phone access stopped. Benwa's local worker and database stay running.",
  );
  process.exit(0);
}

async function reachable(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}
if ((await reachable(4341)) || (await reachable(4342)))
  throw new Error(
    "Phone access is already running, or its private ports are occupied",
  );

// Pin the executable as well as the download URL. Never execute an unverified replacement.
const executable = path.join(repoRoot, ".data", "tools", "cloudflared.exe");
const digest = createHash("sha256")
  .update(await fs.readFile(executable))
  .digest("hex");
if (
  digest !== "d5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a"
)
  throw new Error(
    "Cloudflared does not match the verified 2026.11.0 Windows release",
  );

const children: ChildProcess[] = [];
let stopping = false;
let control: http.Server | undefined;
const log = createWriteStream(path.join(directory, "service.log"), {
  flags: "a",
});
function launch(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  children.push(child);
  return child;
}
async function cleanup() {
  if (stopping) return;
  stopping = true;
  // Close the public tunnel first. These are only processes owned by this launcher.
  for (const child of children) {
    child.stdout?.unpipe(log);
    child.stderr?.unpipe(log);
    if (child.exitCode === null) child.kill();
  }
  control?.close();
  await fs.rm(path.join(directory, "access.json"), { force: true });
  await fs.writeFile(
    path.join(directory, "login.txt"),
    "Phone access is stopped. Restart with npm run phone.\n",
  );
  log.end();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void cleanup();
  });

try {
  // The normal local launcher owns the worker, supervisor and durable database.
  if (!(await reachable(4321))) {
    const localLog = await fs.open(path.join(directory, "local.log"), "a");
    const local = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/dev.ts"],
      {
        cwd: repoRoot,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", localLog.fd, localLog.fd],
        env: process.env,
      },
    );
    local.unref();
    await localLog.close();
    let ready = false;
    for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
      if (await reachable(4321)) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready)
      throw new Error(
        "Local Benwa did not start; inspect .data/phone/local.log",
      );
  }
  if (stopping) throw new Error("Startup stopped");

  // An empty config prevents accidental reuse of a separately configured tunnel.
  const configFile = path.join(directory, "cloudflared.yml");
  await fs.writeFile(configFile, "{}\n");
  const tunnelEnv: NodeJS.ProcessEnv = {};
  for (const key of [
    "SystemRoot",
    "WINDIR",
    "PATH",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
  ])
    if (process.env[key]) tunnelEnv[key] = process.env[key];
  const tunnel = spawn(
    executable,
    [
      "tunnel",
      "--config",
      configFile,
      "--no-autoupdate",
      "--protocol",
      "http2",
      "--url",
      origin,
    ],
    {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: tunnelEnv,
    },
  );
  children.push(tunnel);
  tunnel.stdout?.pipe(log, { end: false });
  tunnel.stderr?.pipe(log, { end: false });
  const publicUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Cloudflare did not issue a temporary URL")),
      60000,
    );
    let output = "";
    const inspect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16000);
      const found = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
      if (found) {
        clearTimeout(timer);
        resolve(found[0]);
      }
    };
    tunnel.stdout?.on("data", inspect);
    tunnel.stderr?.on("data", inspect);
    tunnel.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    tunnel.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Cloudflare tunnel exited during startup"));
    });
  });
  console.log(
    "Temporary HTTPS address allocated. Building the protected phone dashboard...",
  );
  const webRequire = createRequire(
    path.join(repoRoot, "apps", "web", "package.json"),
  );
  const astroPackage = webRequire.resolve("astro/package.json");
  const manifest = JSON.parse(await fs.readFile(astroPackage, "utf8")) as {
    bin: { astro: string };
  };
  const outputDirectory = path.join(repoRoot, "apps", "web", "dist-phone");
  const build = launch(
    [
      path.resolve(path.dirname(astroPackage), manifest.bin.astro),
      "build",
      "--root",
      path.join(repoRoot, "apps", "web"),
      "--outDir",
      outputDirectory,
    ],
    { BENWA_PUBLIC_HOST: new URL(publicUrl).hostname },
  );
  const [buildCode] = await once(build, "exit");
  if (buildCode !== 0 || stopping)
    throw new Error(
      "Phone dashboard build did not complete; inspect .data/phone/service.log",
    );
  const server = launch([path.join(outputDirectory, "server", "entry.mjs")], {
    HOST: "127.0.0.1",
    PORT: "4341",
    BENWA_ROOT: repoRoot,
    DASHBOARD_PASSWORD: credentials.password,
    SESSION_SECRET: credentials.sessionSecret,
  });
  let ready = false;
  for (let attempt = 0; attempt < 80 && !stopping; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Protected phone server exited; inspect service.log");
    if (await reachable(4341)) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Protected phone server did not start");

  // Verify the real HTTPS route before presenting it. No model calls or state mutations.
  let anonymous: Response | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      anonymous = await fetch(`${publicUrl}/api/state`, {
        signal: AbortSignal.timeout(8000),
      });
      if (anonymous.status === 401) break;
    } catch {
      /* DNS and the edge connection can take a few seconds to settle. */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(
    anonymous?.status,
    401,
    "Public API must reject unauthenticated access",
  );
  const login = await fetch(`${publicUrl}/api/login`, {
    method: "POST",
    headers: { origin: publicUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ password: credentials.password }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(login.status, 200, "HTTPS login must succeed");
  const session = login.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("benwa_session="));
  assert(session, "Login must issue a session cookie");
  assert(
    session?.includes("Secure") &&
      session.includes("HttpOnly") &&
      session.includes("SameSite=Strict"),
  );
  const cookie = session.split(";")[0];
  const stateResponse = await fetch(`${publicUrl}/api/state`, {
    headers: { cookie },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(
    stateResponse.status,
    200,
    "Authenticated phone dashboard must reach Benwa's state",
  );
  const state = (await stateResponse.json()) as {
    creature: { status: string };
    workerOnline: boolean;
  };
  const rejected = await fetch(`${publicUrl}/api/control`, {
    method: "POST",
    headers: {
      cookie,
      origin: "https://untrusted.invalid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command: "pause" }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(rejected.status, 403, "Cross-origin controls must be rejected");
  await fs.writeFile(
    path.join(directory, "login.txt"),
    `Benwa phone access\n\nAddress: ${publicUrl}\nPassword: ${credentials.password}\n\nKeep your PC awake and connected to the internet.\nThis temporary address changes after restarting phone access.\nStop phone access with: npm run phone:stop\n`,
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(directory, "access.json"),
    JSON.stringify(
      {
        url: publicUrl,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        loginFile: path.join(directory, "login.txt"),
      },
      null,
      2,
    ),
  );
  control = http.createServer((request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${credentials.controlToken}`);
    if (
      request.url !== "/stop" ||
      request.method !== "POST" ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(200).end("Phone access stopped");
    void cleanup();
  });
  control.listen(4342, "127.0.0.1");
  await once(control, "listening");
  console.log(`Phone access ready: ${publicUrl}`);
  console.log(
    `Password saved privately in ${path.join(directory, "login.txt")}`,
  );
  console.log(
    `Verified: public API authentication, HTTPS login, Secure cookie, state access and origin protection. Worker online: ${state.workerOnline}. State: ${state.creature.status}.`,
  );
  for (const child of [tunnel, server])
    child.once("exit", () => {
      if (!stopping) {
        console.error("Phone access stopped because a service exited.");
        void cleanup();
      }
    });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Phone access failed");
  await cleanup();
  process.exitCode = 1;
}
