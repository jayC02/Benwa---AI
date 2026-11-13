import { spawn } from "node:child_process";
import path from "node:path";
import { env, repoRoot } from "./config.js";
import { projectDirectory } from "./workspace.js";
const running = new Set<string>();
let availability: { until: number; value: boolean } | undefined;
export async function sandboxAvailable() {
  if (availability && availability.until > Date.now())
    return availability.value;
  let value = false;
  try {
    value =
      (await docker(["image", "inspect", env.SANDBOX_IMAGE], 5000)).code === 0;
  } catch {
    /* No connected sandbox runtime. */
  }
  availability = { until: Date.now() + 60000, value };
  return value;
}
export async function terminateSandboxes() {
  await Promise.allSettled(
    [...running].map((name) => docker(["rm", "-f", name], 5000)),
  );
}
async function docker(
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Sandbox timed out"));
    }, timeout);
    const add = (chunk: Buffer, error = false) => {
      size += chunk.length;
      if (size > 1000000) {
        child.kill();
        reject(new Error("Sandbox output limit exceeded"));
        return;
      }
      if (error) stderr += chunk.toString();
      else stdout += chunk.toString();
    };
    child.stdout.on("data", (c: Buffer) => add(c));
    child.stderr.on("data", (c: Buffer) => add(c, true));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Sandbox unavailable: ${e.message}. Install Docker and build the sandbox image; host execution is forbidden.`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, 20000),
        stderr: stderr.slice(0, 5000),
        code: code ?? -1,
      });
    });
  });
}
export async function runSandbox(
  projectId: string,
  actionId: string,
  command: "test" | "node" | "browser",
  file: string,
) {
  const dir = await projectDirectory(projectId);
  const name = `benwa-${actionId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 50)}`;
  const argv =
    command === "test"
      ? ["node", "--test", file]
      : command === "node"
        ? ["node", file]
        : ["node", "/runner/browser.mjs", file];
  const args = [
    "run",
    "--rm",
    "--pull=never",
    "--name",
    name,
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--pids-limit",
    "128",
    "--cpus",
    "0.5",
    "--memory",
    "512m",
    "--memory-swap",
    "512m",
    "--user",
    "1000:1000",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=96m",
    "--mount",
    `type=bind,source=${dir},target=/project,readonly`,
    "--mount",
    `type=bind,source=${path.join(repoRoot, "sandbox", "runner")},target=/runner,readonly`,
    "--workdir",
    "/project",
    env.SANDBOX_IMAGE,
    ...argv,
  ];
  running.add(name);
  try {
    return await docker(args, 45000);
  } finally {
    await docker(["rm", "-f", name], 5000).catch(() => {});
    running.delete(name);
  }
}
