#!/bin/sh
# Ships the bot from this Mac to the Oracle VM and (re)starts it. Run from the repo root:
#   sh deploy/oracle/deploy.sh ubuntu@<vm-ip>
# Copies the code and the root .env over SSH (no GitHub access needed on the server),
# installs Docker the first time, then builds and starts the worker.
# SSH key: $SSH_KEY, else ~/.ssh/oracle_notetaker if it exists, else ssh's default.
set -e

TARGET="$1"
if [ -z "$TARGET" ]; then
  echo "usage: sh deploy/oracle/deploy.sh ubuntu@<vm-ip>" >&2
  exit 1
fi
cd "$(dirname "$0")/../.."
[ -f .env ] || { echo "No .env at the repo root." >&2; exit 1; }
if grep -q "FILL_ME" .env; then
  echo "Fill in these .env values first:" >&2
  grep "FILL_ME" .env | cut -d= -f1 | sed 's/^/  /' >&2
  exit 1
fi

KEY="${SSH_KEY:-$HOME/.ssh/oracle_notetaker}"
SSH="ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30"
[ -f "$KEY" ] && SSH="$SSH -i $KEY"

echo "→ copying code to $TARGET:~/notetaker"
# Tracked and new (non-ignored) files, minus .env, which goes separately with tight permissions.
# The server's copy is replaced wholesale; the bot's data lives in a Docker volume, not here.
git ls-files -co --exclude-standard | grep -v '^\.env' | while read -r f; do [ -e "$f" ] && echo "$f"; done \
  | COPYFILE_DISABLE=1 tar -czf - --no-xattrs -T - \
  | $SSH "$TARGET" 'rm -rf notetaker.next && mkdir notetaker.next && tar -xzf - -C notetaker.next 2>/dev/null \
      && rm -rf notetaker && mv notetaker.next notetaker'
$SSH "$TARGET" 'umask 077 && cat > notetaker/.env' < .env

echo "→ starting the bot (first build on ARM takes ~10 minutes)"
$SSH "$TARGET" sh -s <<'REMOTE'
set -e
cd ~/notetaker
if ! command -v docker >/dev/null; then sh deploy/oracle/setup.sh; fi
# Right after setup this login isn't in the docker group yet.
DOCKER=docker
docker info >/dev/null 2>&1 || DOCKER="sudo docker"
cd deploy/oracle
$DOCKER compose up -d --build --remove-orphans
$DOCKER compose ps
$DOCKER image prune -f >/dev/null
REMOTE

echo
echo "Done. Logs: $SSH $TARGET 'cd notetaker/deploy/oracle && docker compose logs -f worker'"
echo "The dashboard shows \"Bot server online\" within 30 seconds."
