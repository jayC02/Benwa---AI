# Benwa on a free server

Prepared on 13 November 2026. **Current choice: keep hosting at £0 on the existing PC, with local access only.** Oracle's free A1 capacity was unavailable in the attempted London availability domains, and the operator also reported failure with the micro shape. No VM was created. No public tunnel or paid host is running. The [optional phone launcher](PHONE.md) is prepared but has not been activated; the operator chose to leave Benwa on this PC. The VM instructions below remain a prepared alternative, not a live deployment.

The existing dashboard, worker and supervisor run as separate systemd services on one Ubuntu VM. PostgreSQL runs in Docker on loopback, with durable disk storage. The trusted host worker retains access to Benwa's existing isolated Docker tools; no Docker socket is mounted into an application container. Caddy supplies HTTPS. No agent architecture, personality, business objective or dashboard layout is replaced.

## Account and VM

Create one account at <https://signup.cloud.oracle.com/>. Stay on the free account; do not upgrade to Pay As You Go. Oracle requires a valid card for identity verification and may place a temporary authorisation hold. [Official signup FAQ](https://www.oracle.com/cloud/free/faq/).

In the home region, create an instance with:

- Name: `benwa`.
- Image: standard **Ubuntu 24.04 LTS**, matching the CPU architecture; avoid separately licensed images.
- Shape: **VM.Standard.A1.Flex**, at most **2 OCPUs and 12 GB RAM total across the account**.
- Boot disk: the default approximately **50 GB**, within the account's combined **200 GB** Always Free storage allowance. Keep the default disk performance.
- An internet-connected public subnet and public IPv4 address.
- SSH key: upload `.data/deploy/benwa-server.pub` produced by `npm run deploy:prepare`. Keep the matching private key on this computer.

Confirm the Console marks the selected resources as Always Free eligible. Do not substitute a paid shape if capacity is unavailable. These limits are current configuration guidance, not an availability or uptime guarantee. Oracle can reclaim idle free instances. [Official Always Free resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Allow inbound TCP **80 and 443** in the instance's OCI security list or network security group. Restrict SSH port **22** to the operator's public IP where practical. Keep **5432, 54329 and 4321 private**. The installer adds only HTTP/HTTPS host firewall rules and preserves SSH rules.

A hostname can use an existing domain or the free address `benwa.<PUBLIC-IP>.sslip.io`. This public DNS service resolves the embedded IP without a domain purchase. Its availability and shared certificate limits are external dependencies. [sslip.io documentation](https://sslip.io/). The hostname must resolve to the server and ports 80/443 must be reachable for Caddy's certificate issuance.

## Prepare and transfer existing state

Leave Benwa paused or waiting for approval, with no action executing. Run:

```powershell
npm run deploy:prepare
```

This writes a private timestamped directory under `.data/deploy/` and records its path in `.data/deploy/latest.json`. It includes:

- Source archive excluding dependencies, compiled output, runtime data and `.env`.
- A complete database snapshot including memories, goals, projects, emotions, approvals, financial history, model access records, quota reservations and cooldowns.
- A separate project-file archive.
- New server-only database and session secrets, the existing Gemini configuration and a dashboard password stored in `login.txt`.
- SHA-256 checksums for the transfer files.

The Gemini free-project confirmation is required. The preparation step makes no model calls, enables no paid inference and changes no creature state. Treat the entire transfer directory as private; upload it only over SSH to the selected server. It is excluded from source and Docker builds.

Before the final export/cutover, stop the old worker and supervisor. Keep its database up for export. Do not operate two copies against separate usage ledgers with the same Gemini project. Refresh the package immediately before migration if local data changed while the account was being created.

On the selected server, copy the private transfer files into `/home/ubuntu/benwa-transfer`, owned by the SSH operator with mode `0700`. Extract `source.tar.gz` to `/opt/benwa` on this dedicated VM. Then run:

```bash
sudo bash /opt/benwa/deploy/bootstrap-ubuntu.sh benwa.PUBLIC-IP.sslip.io /home/ubuntu/benwa-transfer
```

Replace the hostname with the actual address. The installer targets a **fresh Ubuntu 24.04 VM**. It installs Docker, pinned Node 24.16.0 and Caddy from their official sources, checks the transfer, builds Benwa and his sandbox image, migrates an empty PostgreSQL database, imports the saved state and starts the three existing application services. It refuses to replace an installation's secrets or overwrite existing database history. Do not use this initial-install script as an update script.

The import uses parameterised PostgreSQL JSON records, retains bigint precision and inserts dependent records in dependency order. It requires matching migration hashes and an empty target. It does not disable constraints or the append-only financial ledger trigger, reset quotas, approve pending work or reset Benwa's emotions.

## Verify before switching off the PC

Open the HTTPS address on the phone and log in using the local transfer's `login.txt`. Check the saved project, memories, approvals, model monitoring and worker heartbeat. A waiting approval remains waiting; running the server does not approve publishing or spending.

On the server:

```bash
sudo systemctl status benwa-db benwa-web benwa-worker benwa-supervisor caddy
sudo journalctl -u benwa-worker -u benwa-supervisor --since '10 minutes ago'
```

Reboot once and verify services and the phone login again. Confirm the database is not publicly reachable. Keep the private local transfer as the initial recovery copy; arrange regular off-server database and workspace backups before relying on the free VM for irreplaceable work. Free VM reclamation can interrupt service.

Runtime secrets live in `/etc/benwa/runtime.env` and `/etc/benwa/postgres.env`, outside source and client bundles. Files live in `/var/lib/benwa/projects`; PostgreSQL data lives in `/var/lib/benwa/postgres`. Do not delete these directories when updating application code. The dashboard and database bind to loopback; only Caddy serves public HTTP/HTTPS traffic.

## Verification completed locally

- 54 automated tests passed, including four transfer tests covering exact state/ledger precision, quota retention, dependency restoration, overwrite protection, snapshot validation and busy-worker rejection.
- TypeScript/Astro checks and lint passed.
- Production build passed with an explicit test hostname.
- `npm run deploy:verify` passed against that compiled server: HTTPS proxy login, Secure/HttpOnly/SameSite session cookie, authenticated state access, cross-origin rejection and validated controls. No model calls or live-state changes occurred.
- Ubuntu installer passed `bash -n`; it has not been executed on a Linux server here. Docker is not installed on this Windows host.

For the proxy check, build with `BENWA_PUBLIC_HOST=benwa-deployment.test`, then run `npm run deploy:verify`. A real deployment instead builds with its exact hostname, which Astro uses to validate forwarded headers. Never trust all domains as a shortcut.

## Why this path

Vercel now supports continuously running daemons in beta, but its Hobby daemon allowance is 420 GB-hours per month with a minimum 1 GiB instance: at most 420 running hours for even one instance, before other limits. It pauses daemons when the allowance is exhausted. Daemons also have no persistent local storage. [Vercel daemon limits](https://vercel.com/docs/daemons/limits).

Oracle's free VM can keep the current processes and shared files together without purchasing hosting or restructuring the agent. It still depends on free capacity and Oracle's reclamation policy. No paid hosting plan, Vercel resource, new Google project or additional API key has been created for this deployment.
