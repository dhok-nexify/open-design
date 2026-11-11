#!/usr/bin/env bash
# Install NexTore Designer on a Linux host (NXD-D36).
#
# Run from an unpacked tarball produced by build-tarball.sh:
#   sudo ./install/install.sh
#
# The script is idempotent: it reuses the service user, data directory, env file
# and secret when they already exist. It refuses to run when bubblewrap cannot
# build a namespace as the service user, because the edition fails closed at run
# time in that case and starting the service would only look healthy.
set -euo pipefail

PREFIX=/opt/nextore-designer
DATA_DIR=/var/lib/nextore-designer
SERVICE_USER=nextore-designer
ENV_DIR=/etc/nextore-designer
UNIT_PATH=/etc/systemd/system/nextore-designer.service
START=0

usage() {
  cat <<'USAGE'
usage: install.sh [options]

  --prefix <dir>    install root (default /opt/nextore-designer)
  --data-dir <dir>  daemon data root owned by the service user
                    (default /var/lib/nextore-designer)
  --user <name>     service user (default nextore-designer)
  --start           start the service after installing
  -h, --help        show this message
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --user) SERVICE_USER="$2"; shift 2 ;;
    --start) START=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root (use sudo)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$PAYLOAD_DIR/apps/daemon/dist/cli.js" ]; then
  echo "payload is incomplete: $PAYLOAD_DIR/apps/daemon/dist/cli.js is missing" >&2
  echo "run this script from an unpacked tarball, not from the source tree" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (Node 24). Install it first." >&2
  exit 1
fi

if ! command -v bwrap >/dev/null 2>&1; then
  echo "bubblewrap is required: apt-get install -y bubblewrap" >&2
  exit 1
fi

echo "checking bubblewrap as a service user"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

sandbox_probe() {
  runuser -u "$SERVICE_USER" -- bwrap --die-with-parent --unshare-pid \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp /bin/true
}

sandbox_probe_no_new_privileges() {
  if command -v setpriv >/dev/null 2>&1; then
    runuser -u "$SERVICE_USER" -- setpriv --no-new-privs bwrap --die-with-parent --unshare-pid \
      --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp /bin/true
  else
    sandbox_probe
  fi
}

enable_user_namespaces() {
  local file=/etc/sysctl.d/99-nextore-designer.conf
  : > "$file"
  if sysctl -n kernel.apparmor_restrict_unprivileged_userns >/dev/null 2>&1; then
    printf '%s\n' 'kernel.apparmor_restrict_unprivileged_userns=0' >> "$file"
    sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 || true
  fi
  if sysctl -n kernel.unprivileged_userns_clone >/dev/null 2>&1; then
    printf '%s\n' 'kernel.unprivileged_userns_clone=1' >> "$file"
    sysctl -w kernel.unprivileged_userns_clone=1 || true
  fi
  sysctl --system || true
}

if ! sandbox_probe >/dev/null 2>&1 || ! sandbox_probe_no_new_privileges >/dev/null 2>&1; then
  echo "bubblewrap probe failed; enabling unprivileged user namespaces" >&2
  enable_user_namespaces
fi
if ! sandbox_probe_no_new_privileges; then
  echo "bwrap cannot create a namespace as $SERVICE_USER, even with NoNewPrivileges" >&2
  echo "check AppArmor (aa-status), kernel.unprivileged_userns_clone and setuid bwrap" >&2
  exit 1
fi

echo "installing to $PREFIX"
install -d -m 0755 "$PREFIX"
for entry in LICENSE NOTICE; do
  if [ -f "$PAYLOAD_DIR/$entry" ]; then cp -a "$PAYLOAD_DIR/$entry" "$PREFIX/"; fi
done
cp -a "$PAYLOAD_DIR/apps" "$PREFIX/"
for entry in skills design-systems craft prompt-templates data assets plugins; do
  if [ -d "$PAYLOAD_DIR/$entry" ]; then cp -a "$PAYLOAD_DIR/$entry" "$PREFIX/"; fi
done
chown -R root:root "$PREFIX"

install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
install -d -m 0750 "$ENV_DIR"

if [ ! -f "$ENV_DIR/designer.env" ]; then
  install -m 0640 -o root -g "$SERVICE_USER" "$SCRIPT_DIR/designer.env.example" "$ENV_DIR/designer.env"
  sed -i "s|@DATA_DIR@|$DATA_DIR|g" "$ENV_DIR/designer.env"
  echo "created $ENV_DIR/designer.env — fill in the NexTore values before starting"
else
  echo "keeping existing $ENV_DIR/designer.env"
fi

if [ ! -f "$ENV_DIR/designer_secret" ]; then
  ( umask 027; openssl rand -hex 32 > "$ENV_DIR/designer_secret" )
  chown root:"$SERVICE_USER" "$ENV_DIR/designer_secret"
  chmod 0640 "$ENV_DIR/designer_secret"
  echo "generated $ENV_DIR/designer_secret (rotating it invalidates sessions)"
else
  echo "keeping existing $ENV_DIR/designer_secret"
fi

if [ -f "$SCRIPT_DIR/OPENCODE_VERSION" ] && [ -x /usr/bin/npm ]; then
  version="$(cat "$SCRIPT_DIR/OPENCODE_VERSION")"
  if ! command -v opencode >/dev/null 2>&1; then
    echo "installing opencode-ai@$version"
    npm install --global --omit=dev "opencode-ai@$version"
  fi
fi

sed -e "s|@PREFIX@|$PREFIX|g" \
    -e "s|@DATA_DIR@|$DATA_DIR|g" \
    -e "s|@USER@|$SERVICE_USER|g" \
    "$SCRIPT_DIR/nextore-designer.service.in" > "$UNIT_PATH"
chmod 0644 "$UNIT_PATH"

if ! systemd-run --quiet --wait --pipe --collect \
      --property=User="$SERVICE_USER" \
      --property=NoNewPrivileges=no \
      --property=PrivateTmp=yes \
      --property=ProtectSystem=full \
      --property=ProtectHome=yes \
      /usr/bin/bwrap --die-with-parent --unshare-pid \
        --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp /bin/true; then
  echo "bwrap works from a shell but not inside a systemd unit" >&2
  exit 1
fi

systemctl daemon-reload
systemctl enable nextore-designer

if [ "$START" -eq 1 ]; then
  systemctl restart nextore-designer
  for i in $(seq 1 30); do
    if node -e 'fetch("http://127.0.0.1:7456/api/health").then(r=>r.json()).then(h=>process.exit(h && h.ok ? 0 : 1)).catch(()=>process.exit(1))' 2>/dev/null; then break; fi
    sleep 1
  done
  node -e 'fetch("http://127.0.0.1:7456/api/health").then(r=>r.json()).then(h=>{if(!h.sandbox||h.sandbox.ok!==true){console.error("sandbox unavailable: "+JSON.stringify(h.sandbox||null));process.exit(1)}}).catch(e=>{console.error(e);process.exit(1)})' \
    || { echo "execution sandbox probe failed at runtime; check AppArmor/user namespaces" >&2; exit 1; }
  echo "started nextore-designer; sandbox probe OK; follow with: journalctl -u nextore-designer -f"
else
  echo "installed. Fill in $ENV_DIR/designer.env, then: systemctl start nextore-designer"
fi
