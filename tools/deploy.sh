#!/bin/sh
# Take a bare Oracle Cloud box to a running product.
#
#   ssh ubuntu@<box>
#   git clone <repo> lian && cd lian
#   sudo sh tools/deploy.sh
#
# IDEMPOTENT. Run it again after a `git pull` and it updates: nothing here
# breaks on a second run, because the second run is the common case and a
# deploy script that only works on a clean box is one nobody uses twice.
#
# POSIX sh, not bash: Oracle's Ubuntu image has both, their Oracle Linux image
# does not, and this is not the place to discover that.
#
# WHAT IT DOES NOT DO, deliberately:
#   - It does not create the database. Neon is a console step, once, and
#     DATABASE_URL is how you tell this box about it.
#   - It does not obtain a TLS certificate silently. Caddy does that on first
#     start, and it needs DNS already pointing here — see docs/DEPLOY.md.
#   - It does not set secrets. It reads .env and says exactly which required
#     ones are missing, rather than starting a product that cannot talk.
set -eu

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
step() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31m  %s\033[0m\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run this with sudo — it installs packages and manages services."
cd "$(dirname "$0")/.."
ROOT=$(pwd)

# ── 1. what must already be true ──────────────────────────────────────────
say "1. Checking what has to be true before anything is installed"

[ -f .env ] || die ".env does not exist. Copy .env.example and fill it in — docs/DEPLOY.md step 6."

# Read it without exporting the whole file into this shell: a stray line in a
# .env should not be able to set PATH.
required='DATABASE_URL LIAN_PUBLIC_URL LIAN_TICK_SECRET ANTHROPIC_API_KEY LIAN_VAPID_PUBLIC_KEY LIAN_VAPID_PRIVATE_KEY'
missing=''
for name in $required; do
  value=$(grep -E "^${name}=" .env | head -1 | cut -d= -f2- || true)
  [ -n "$value" ] || missing="$missing $name"
done
[ -z "$missing" ] || die "these are missing from .env:$missing
  \`npm run keys vapid\` and \`npm run keys tick\` produce two of them.
  docs/DEPLOY.md says where the rest come from."

# ARM, and the reason to check: this script installs an arm64 Docker
# repository and would half-succeed on x86.
arch=$(uname -m)
step "architecture: $arch"
[ "$arch" = "aarch64" ] || step "  (not aarch64 — that is fine here, but the target box is an Ampere A1)"

# ── 2. system dependencies ────────────────────────────────────────────────
say "2. System dependencies"
if command -v docker >/dev/null 2>&1; then
  step "docker: already installed ($(docker --version | cut -d, -f1))"
else
  step "installing docker…"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# postgresql-client for ad-hoc work — a psql session when something is wrong,
# and a manual restore. The BACKUP JOB does not need it here: it runs inside
# the image, which carries its own. That distinction is worth keeping straight,
# because installing it here and assuming the container had it is exactly the
# mistake this line used to be.
if command -v psql >/dev/null 2>&1; then
  step "postgresql-client: already installed"
else
  step "installing postgresql-client (for your own psql sessions)…"
  apt-get install -y -qq postgresql-client
fi

# ── 3. THE FIREWALL, which is the Oracle gotcha ───────────────────────────
say "3. The firewall"
# Oracle's Ubuntu images ship iptables rules that REJECT everything except
# SSH, in addition to the cloud-side security list. Opening the port in the
# console and not here is the single most common reason a correctly deployed
# box appears dead, and it produces a connection TIMEOUT rather than a
# refusal, which reads like DNS.
if command -v netfilter-persistent >/dev/null 2>&1; then
  for port in 80 443; do
    if iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
      step "port $port: already open"
    else
      step "opening port $port…"
      iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
    fi
  done
  netfilter-persistent save >/dev/null 2>&1 || true
  step "NOTE: this is the BOX's firewall. The security list in the Oracle"
  step "      console is separate and also has to allow 80 and 443."
else
  step "no netfilter-persistent — skipping (not an Oracle Ubuntu image?)"
fi

# ── 4. build ──────────────────────────────────────────────────────────────
say "4. Building the image"
step "this takes a few minutes on 2 OCPUs"
docker build --target runtime -t lian:latest "$ROOT"

# ── 5. migrations, before anything serves ─────────────────────────────────
say "5. Migrations"
# In a one-shot container rather than at boot: a migration that fails should
# stop the deploy, not leave a restarting service that half-serves.
docker run --rm --env-file .env lian:latest node tools/migrate.ts

# ── 6. up ─────────────────────────────────────────────────────────────────
say "6. Starting"
docker compose -f docker-compose.prod.yml --env-file .env up -d --remove-orphans

# ── 7. THE HEALTH CHECK THAT FAILS LOUDLY ─────────────────────────────────
say "7. Health"
# The point of this step. A deploy that reports success because a container
# is running, while the database is unreachable, is a deploy that has told
# you the opposite of the truth. /health/ready asks each dependency and names
# the failing one.
port=$(grep -E '^PORT=' .env | cut -d= -f2- || true)
port=${port:-8787}
step "waiting for readiness on :$port…"
ready=''
i=0
while [ "$i" -lt 60 ]; do
  body=$(curl -fsS "http://127.0.0.1:$port/health/ready" 2>/dev/null || true)
  case "$body" in *'"ready":true'*) ready=$body; break;; esac
  i=$((i + 1))
  sleep 2
done

if [ -z "$ready" ]; then
  last=$(curl -sS "http://127.0.0.1:$port/health/ready" 2>/dev/null || echo '(no response at all)')
  printf '\n'
  docker compose -f docker-compose.prod.yml logs --tail 40 server || true
  die "NOT READY after two minutes. The endpoint says:
  $last
  A \"failing\" entry names which dependency. Fix that one — docs/DEPLOY.md §troubleshooting."
fi

step "ready: $ready"

# Anything degraded but not fatal, said out loud rather than buried.
case "$ready" in
  *'"failing":[]'*) : ;;
  *) step ""
     step "SOME DEPENDENCIES ARE FAILING and the app started anyway — that is"
     step "deliberate (storage down means an attachment refuses; the model"
     step "down means she says so). The line above names them." ;;
esac

# ── 8. the index rebuild, which nothing else will do ──────────────────────
say "8. The vector index"
# An ivfflat index built by a migration on an empty table has centroids from
# no data. Nothing in the product notices — the failure mode is a memory
# stored twice — so this is checked here and on every deploy.
if docker run --rm --env-file .env lian:latest node tools/preflight.ts db; then
  step "the index is answering"
else
  step ""
  step "The index check FAILED. It is not fatal to serving, which is why this"
  step "does not stop the deploy — but she will store memories she already has"
  step "until it is fixed:"
  step "  psql \"\$DATABASE_URL\" -c 'REINDEX INDEX CONCURRENTLY memories_embedding_idx'"
fi

say "Done."
printf '  %s\n\n' "$(grep -E '^LIAN_PUBLIC_URL=' .env | cut -d= -f2-)"
