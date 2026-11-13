# Free phone access from this PC

**Not activated.** On 13 November 2026 the operator chose to leave Benwa on this PC with local access only. Local production authentication checks passed; no public tunnel has been started or verified. The instructions below are an optional future setup.

Run `npm run phone`, or double-click **Start Benwa Phone.cmd**. The first build takes a little time. The launcher starts the normal local Benwa service if needed and creates a separate password-protected production dashboard on loopback port 4341. It leaves the existing local dashboard, worker, supervisor, memory and database in place. It does not start a paused creature or reset a model cooldown.

Open `.data/phone/login.txt` on this PC for the current HTTPS address and password. Enter these on your phone, including when using mobile data. The password is separate from the Gemini key; do not paste API keys into the dashboard or into chat. Credentials and logs stay under the ignored `.data` directory. Keep this directory private.

The tool verifies unauthenticated API rejection, HTTPS password login, Secure/HttpOnly/SameSite session cookies, authenticated state access and cross-origin control rejection before recording a ready address. Cloudflared receives a minimal OS environment without Benwa's API secrets. It forwards only the protected phone port; the development server and database are not tunnel targets. The app trusts only the exact generated public hostname.

`npm run phone:stop` closes phone access while leaving local Benwa running. Restarting generates a new temporary address and keeps the same private dashboard password. Closing the PC, sleep, loss of internet or stopping the tunnel makes phone access unavailable. No account, paid hosting plan, domain purchase or port forwarding is required. This is a temporary development tunnel, with no uptime guarantee; it is not a cloud deployment. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

The launcher currently targets Windows x64 and pins Cloudflare's official `cloudflared` 2026.11.0 binary in `.data/tools/cloudflared.exe`, SHA-256 `d5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a`. Update the pinned version and digest together after verifying a future official release. The executable is never included in source archives or Docker builds. [Official release](https://github.com/cloudflare/cloudflared/releases/tag/2026.11.0).
