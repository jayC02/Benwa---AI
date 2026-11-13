import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import tailwind from "@tailwindcss/vite";
const publicHost = process.env.BENWA_PUBLIC_HOST;
if (
  publicHost &&
  (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/.test(publicHost) ||
    publicHost.includes(".."))
)
  throw new Error("BENWA_PUBLIC_HOST must be the exact dashboard hostname");
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  security: {
    allowedDomains: publicHost
      ? [{ protocol: "https", hostname: publicHost }]
      : [],
  },
  vite: { plugins: [tailwind()], ssr: { noExternal: ["@benwa/core"] } },
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
