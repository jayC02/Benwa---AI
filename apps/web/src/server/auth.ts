import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  scryptSync,
} from "node:crypto";
import { env } from "@benwa/core";
const shared = globalThis as typeof globalThis & {
  benwaSessionSecret?: string;
};
export const sessionSecret =
  env.SESSION_SECRET ||
  (shared.benwaSessionSecret ??= randomBytes(32).toString("hex"));
if (env.DASHBOARD_PASSWORD && env.SESSION_SECRET.length < 32)
  throw new Error(
    "Set SESSION_SECRET to at least 32 characters when using dashboard authentication",
  );
export function localHostname(host: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(host);
}
function mac(value: string) {
  return createHmac("sha256", sessionSecret).update(value).digest("hex");
}
export function issueSession() {
  const value = String(Date.now() + 86400000);
  return `${value}.${mac(value)}`;
}
export function validSession(value: string | undefined) {
  if (!value) return false;
  const [expires, signature] = value.split(".");
  return (
    /^\d+$/.test(expires) &&
    Number(expires) > Date.now() &&
    Boolean(signature) &&
    signature.length === 64 &&
    timingSafeEqual(Buffer.from(mac(expires)), Buffer.from(signature))
  );
}
const loginFailures = new Map<string, { count: number; until: number }>();
export function authenticatePassword(password: string, ip: string) {
  const entry = loginFailures.get(ip);
  if (entry && entry.until > Date.now() && entry.count >= 5)
    throw new Error("Too many login attempts. Try again in fifteen minutes.");
  const valid = timingSafeEqual(
    scryptSync(password, "benwa-dashboard", 32),
    scryptSync(env.DASHBOARD_PASSWORD, "benwa-dashboard", 32),
  );
  if (!valid) {
    loginFailures.set(ip, {
      count: (entry?.count ?? 0) + 1,
      until: Date.now() + 900000,
    });
    return false;
  }
  loginFailures.delete(ip);
  return true;
}
