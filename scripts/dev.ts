import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { repoRoot, env } from "../packages/core/src/config.js";
const children: ChildProcess[] = [];
const tsx = fileURLToPath(import.meta.resolve("tsx/cli"));
function launch(script: string, args: string[] = []) {
  const p = spawn(
    process.execPath,
    script === tsx ? ["--import", "tsx", ...args] : [script, ...args],
    {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    },
  );
  children.push(p);
  return p;
}
async function command(script: string, args: string[] = []) {
  const p = launch(script, args);
  await new Promise<void>((resolve, reject) => {
    p.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Startup command exited ${code}`)),
    );
    p.once("error", reject);
  });
}
function reachable(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    s.setTimeout(500, () => {
      s.destroy();
      resolve(false);
    });
  });
}
async function cleanup() {
  for (const p of children) p.kill();
}
process.on("SIGINT", () => {
  void cleanup().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void cleanup().then(() => process.exit(0));
});
try {
  if (
    env.DATABASE_URL.includes("127.0.0.1:54329") &&
    !(await reachable(54329))
  ) {
    launch(tsx, ["scripts/database.ts"]);
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (await reachable(54329)) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) throw new Error("Embedded PostgreSQL did not become ready");
  }
  await command(fileURLToPath(import.meta.resolve("prisma/build/index.js")), [
    "migrate",
    "deploy",
  ]);
  await command(tsx, ["scripts/seed.ts"]);
  launch(tsx, ["apps/worker/src/main.ts"]);
  launch(tsx, ["apps/worker/src/supervisor.ts"]);
  const webRequire = createRequire(
    path.join(repoRoot, "apps", "web", "package.json"),
  );
  const astroPackage = webRequire.resolve("astro/package.json");
  const astroManifest = JSON.parse(await fs.readFile(astroPackage, "utf8")) as {
    bin: { astro: string };
  };
  launch(path.resolve(path.dirname(astroPackage), astroManifest.bin.astro), [
    "dev",
    "--root",
    "apps/web",
    "--host",
    "127.0.0.1",
  ]);
  console.log(
    "Benwa is ready at http://127.0.0.1:4321. Start him from the dashboard.",
  );
} catch (e) {
  console.error(e);
  await cleanup();
  process.exit(1);
}
