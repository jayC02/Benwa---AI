import fs from "node:fs/promises";
import path from "node:path";
import { workspaceRoot } from "./config.js";
export async function projectDirectory(projectId: string) {
  if (!/^[a-z0-9_-]{1,100}$/i.test(projectId))
    throw new Error("Invalid project identifier");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const root = await fs.realpath(workspaceRoot);
  const dir = path.join(root, projectId);
  await fs.mkdir(dir, { recursive: true });
  if (
    (await fs.lstat(dir)).isSymbolicLink() ||
    (await fs.realpath(dir)) !== dir
  )
    throw new Error("Workspace link rejected");
  return dir;
}
export async function safeFile(
  projectId: string,
  relative: string,
  createParents = false,
) {
  if (
    !relative ||
    relative.length > 240 ||
    relative.includes("\\") ||
    relative.includes(":") ||
    relative.includes("\0") ||
    relative
      .split("/")
      .some((p) => p === ".." || p === "." || p.startsWith(".")) ||
    path.isAbsolute(relative)
  )
    throw new Error("Unsafe workspace path");
  const dir = await projectDirectory(projectId);
  const segments = relative.split("/");
  let cursor = dir;
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i]) throw new Error("Empty path component");
    cursor = path.join(cursor, segments[i]);
    try {
      const s = await fs.lstat(cursor);
      if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory()))
        throw new Error("Workspace links and special files are forbidden");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      if (createParents && i < segments.length - 1) await fs.mkdir(cursor);
    }
  }
  return cursor;
}
export async function readArtifact(projectId: string, relative: string) {
  const file = await safeFile(projectId, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 200000)
    throw new Error("Artifact exceeds inspection limit");
  return fs.readFile(file, "utf8");
}
export async function workspaceManifest(projectId: string) {
  const directory = await projectDirectory(projectId);
  const entries = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .slice(0, 20);
  return Promise.all(
    entries.map(async (entry) => {
      const stat = await fs.stat(await safeFile(projectId, entry.name));
      return {
        path: entry.name,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    }),
  );
}
