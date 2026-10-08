# Build from the repo root:  docker build -f apps/web/Dockerfile -t notetaker-web .
FROM node:24-slim

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @notetaker/web... --frozen-lockfile=false

COPY packages/db packages/db
COPY apps/web apps/web

# The db client throws on import without DATABASE_URL; nothing connects during the build.
RUN DATABASE_URL=postgres://build:build@localhost/build pnpm --filter @notetaker/web build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@notetaker/web", "start"]