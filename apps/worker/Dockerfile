# Build from the repo root:  docker build -f apps/worker/Dockerfile -t notetaker-worker .
# Keep the Playwright image tag in sync with the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# pulseaudio: a virtual sound card, so Chrome actually renders call audio for capture.
# x11vnc: lets an admin see the virtual screen once, to sign the bot into Google.
RUN apt-get update \
 && apt-get install -y --no-install-recommends pulseaudio x11vnc \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --filter @notetaker/worker... --frozen-lockfile=false

COPY packages/db packages/db
COPY apps/worker apps/worker

WORKDIR /app/apps/worker
# Meet is far more reliable with a real (virtual) display than in headless mode.
ENV BOT_HEADLESS=false \
    BOT_PROFILES_DIR=/data/bot-profiles
VOLUME /data
ENTRYPOINT ["/app/apps/worker/docker-entrypoint.sh"]
CMD ["pnpm", "start"]
