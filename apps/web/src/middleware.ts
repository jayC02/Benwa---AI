import { defineMiddleware } from "astro:middleware";
import { env, json } from "@benwa/core";
import { validSession, issueSession, localHostname } from "./server/auth";
export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, cookies } = context;
  if (url.pathname === "/api/stripe") return next();
  const loopback = localHostname(url.hostname);
  if (!env.DASHBOARD_PASSWORD && (!loopback || process.env.HOST === "0.0.0.0"))
    return new Response(
      "Configure DASHBOARD_PASSWORD and SESSION_SECRET before exposing the dashboard.",
      { status: 503 },
    );
  const isLogin = url.pathname === "/login" || url.pathname === "/api/login";
  if (!isLogin && !validSession(cookies.get("benwa_session")?.value)) {
    if (!env.DASHBOARD_PASSWORD && loopback && request.method === "GET")
      cookies.set("benwa_session", issueSession(), {
        httpOnly: true,
        sameSite: "strict",
        secure: url.protocol === "https:",
        path: "/",
        maxAge: 86400,
      });
    else
      return url.pathname.startsWith("/api/")
        ? new Response(json({ error: "Authentication required" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        : context.redirect("/login");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get("origin") !== url.origin)
      return new Response(json({ error: "Request origin rejected" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    if (Number(request.headers.get("content-length") ?? 0) > 150000)
      return new Response("Request too large", { status: 413 });
  }
  const response = await next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cache-Control", "no-store");
  if (url.pathname.startsWith("/api/"))
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; sandbox",
    );
  return response;
});
