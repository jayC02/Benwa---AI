#!/usr/bin/env bash
# Run on the dedicated Ubuntu VM after uploading source and private transfer files.
set -euo pipefail
umask 077
if [[ $EUID -ne 0 ]]; then echo 'Run with sudo.' >&2; exit 1; fi
domain=${1:?Usage: sudo bash deploy/bootstrap-ubuntu.sh <dashboard-hostname> <private-transfer-directory>}
transfer=$(realpath "${2:?Private transfer directory is required}")
if [[ ! $domain =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ || $domain != *.* || $domain == *..* ]]; then
  echo 'Supply a valid public DNS hostname, without a URL scheme or path.' >&2; exit 1
fi
source /etc/os-release
if [[ $ID != ubuntu || $VERSION_ID != 24.04 ]]; then echo 'This installer targets Ubuntu 24.04 LTS.' >&2; exit 1; fi
cd /opt/benwa
for file in runtime.env postgres.env state.json projects.tar.gz source.tar.gz checksums.sha256; do
  test -f "$transfer/$file" || { echo "Missing private transfer file: $file" >&2; exit 1; }
done
(cd "$transfer"; sha256sum --check --strict checksums.sha256)
if [[ -e /etc/benwa/runtime.env || -e /var/lib/benwa/postgres/PG_VERSION ]]; then
  echo 'A Benwa installation already exists. Refusing to replace its secrets or data.' >&2; exit 1
fi
apt-get update
apt-get install -y ca-certificates curl gnupg xz-utils openssl
# The Always Free Micro fallback has 1 GB RAM. Swap stays on its existing
# free boot disk and prevents package builds from exhausting physical memory.
memory_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
if (( memory_kb < 2000000 )) && ! swapon --show=NAME --noheadings | grep -q .; then
  swapfile=/var/lib/benwa-server.swap
  if [[ -e $swapfile ]]; then echo 'Unexpected pre-existing Benwa swap file; inspect before continuing.' >&2; exit 1; fi
  fallocate -l 4G "$swapfile"
  chmod 0600 "$swapfile"
  mkswap "$swapfile"
  swapon "$swapfile"
  printf '%s none swap sw 0 0\n' "$swapfile" >> /etc/fstab
fi
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
architecture=$(dpkg --print-architecture)
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable\n' "$architecture" > /etc/apt/sources.list.d/docker.list
curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
chmod a+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin caddy
systemctl enable --now docker
case $architecture in arm64) node_arch=arm64;; amd64) node_arch=x64;; *) echo 'Unsupported CPU architecture' >&2; exit 1;; esac
node_version=24.16.0
node_archive="node-v${node_version}-linux-${node_arch}.tar.xz"
download=$(mktemp -d)
curl --fail --silent --show-error --location "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "$download/SHASUMS256.txt"
curl --fail --silent --show-error --location "https://nodejs.org/dist/v${node_version}/$node_archive" -o "$download/$node_archive"
(cd "$download"; grep "  $node_archive\$" SHASUMS256.txt | sha256sum --check --strict -)
tar -xJf "$download/$node_archive" -C /usr/local --strip-components=1
if ! id benwa >/dev/null 2>&1; then useradd --system --create-home --home-dir /var/lib/benwa --shell /usr/sbin/nologin benwa; fi
install -d -o root -g benwa -m 0750 /etc/benwa
install -d -o benwa -g benwa -m 0700 /var/lib/benwa/projects
install -m 0640 -o root -g benwa "$transfer/runtime.env" /etc/benwa/runtime.env
install -m 0600 "$transfer/postgres.env" /etc/benwa/postgres.env
# Build without loading runtime credentials or putting them in the source tree.
npm ci --no-audit --no-fund
BENWA_PUBLIC_HOST="$domain" npm run build
docker build -t benwa-sandbox:local sandbox
chgrp -R benwa /opt/benwa
chmod -R g+rX /opt/benwa
install -m 0644 deploy/benwa-db.service /etc/systemd/system/benwa-db.service
for component in web worker supervisor; do
  case $component in
    web) entrypoint='apps/web/dist/server/entry.mjs';;
    worker) entrypoint='--import tsx apps/worker/src/main.ts';;
    supervisor) entrypoint='--import tsx apps/worker/src/supervisor.ts';;
  esac
  sed -e "s|@COMPONENT@|$component|g" -e "s|@ENTRYPOINT@|$entrypoint|g" deploy/benwa.service.template > "/etc/systemd/system/benwa-$component.service"
done
# Only the trusted worker can launch the existing isolated Docker tools.
mkdir -p /etc/systemd/system/benwa-worker.service.d
printf '[Service]\nSupplementaryGroups=docker\n' > /etc/systemd/system/benwa-worker.service.d/docker.conf
chmod 0644 /etc/systemd/system/benwa-*.service /etc/systemd/system/benwa-worker.service.d/docker.conf
systemctl daemon-reload
systemctl enable --now benwa-db.service
# systemd supplies private runtime values without shell-evaluating the .env file.
systemd-run --quiet --wait --pipe --collect --unit=benwa-migrate -p WorkingDirectory=/opt/benwa -p EnvironmentFile=/etc/benwa/runtime.env /usr/local/bin/npm run db:migrate
systemd-run --quiet --wait --pipe --collect --unit=benwa-restore -p WorkingDirectory=/opt/benwa -p EnvironmentFile=/etc/benwa/runtime.env /usr/local/bin/npm run state -- import "$transfer/state.json"
tar -xzf "$transfer/projects.tar.gz" -C /var/lib/benwa/projects --no-same-owner --no-same-permissions
chown -R benwa:benwa /var/lib/benwa/projects
cat > /etc/caddy/Caddyfile <<EOF
$domain {
  request_body {
    max_size 150KB
  }
  reverse_proxy 127.0.0.1:4321
}
EOF
chown root:caddy /etc/caddy/Caddyfile
chmod 0640 /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable --now benwa-web.service benwa-worker.service benwa-supervisor.service
systemctl enable caddy
systemctl restart caddy
# Oracle Ubuntu images may reject inbound HTTP at the host firewall. Preserve
# existing SSH rules and add only the two public HTTPS/certificate ports.
iptables -C INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save; fi
printf 'Benwa services started. Verify HTTPS, login and worker heartbeat at https://%s before turning off the old computer.\n' "$domain"
