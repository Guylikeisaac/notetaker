#!/bin/sh
# Copies the website's settings from the repo-root .env into the linked Vercel
# project (production). Safe to re-run: existing values are replaced. Values are
# never printed.
#   sh deploy/vercel-env.sh
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No .env at the repo root."; exit 1; }
[ -f .vercel/project.json ] || { echo "Run 'vercel link' at the repo root first."; exit 1; }

val() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

if grep -q FILL_ME .env; then
  echo "Fill in every FILL_ME in .env first."
  exit 1
fi

# The web app runs on serverless functions: use Supabase's transaction pooler
# (port 6543) instead of the session pooler (5432) the worker uses.
DB=$(val DATABASE_URL | sed 's/pooler\.supabase\.com:5432/pooler.supabase.com:6543/')

put() { # put NAME VALUE
  [ -n "$2" ] || return 0
  vercel env rm "$1" production -y >/dev/null 2>&1 || true
  printf '%s' "$2" | vercel env add "$1" production >/dev/null
  echo "  set $1"
}

put DATABASE_URL "$DB"
for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET TOKEN_ENCRYPTION_KEY AUTH_SECRET \
  ALLOWED_EMAIL_DOMAINS ALLOWED_EMAILS ADMIN_EMAILS; do
  put "$name" "$(val "$name")"
done
echo "Done. Redeploy for the changes to apply: vercel deploy --prod"
