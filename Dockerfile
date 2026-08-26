# Lian, as one image.
#
# There is no build step: Node 22 runs the TypeScript directly, so this
# copies source and installs production dependencies. Nothing is bundled,
# nothing is transpiled, and what runs in production is the file you read.
#
# The same image runs both processes — the web server and the external
# ticker (Q16) — selected by the command. They are separate processes on
# purpose: a serverless host has nowhere to run a loop, and a schedule that
# lives inside the web process dies with it.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Manifests first, so a dependency change is the only thing that busts the
# layer cache.
COPY package.json package-lock.json ./
COPY packages/analysis/package.json ./packages/analysis/
COPY packages/auth/package.json ./packages/auth/
COPY packages/capabilities/package.json ./packages/capabilities/
COPY packages/db/package.json ./packages/db/
COPY packages/design/package.json ./packages/design/
COPY packages/domain/package.json ./packages/domain/
COPY packages/http/package.json ./packages/http/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/llm/package.json ./packages/llm/
COPY packages/prompt/package.json ./packages/prompt/
COPY packages/push/package.json ./packages/push/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/voice/package.json ./packages/voice/
COPY apps/server/package.json ./apps/server/
RUN npm ci --omit=dev

COPY packages ./packages
COPY apps ./apps
COPY tools ./tools
# The colour tokens are read at runtime for the manifest and theme-color;
# without this the manifest has no colour and an installed app flashes white.
COPY design-system ./design-system

EXPOSE 8787
# Migrations run at boot (they are idempotent), then the server serves.
CMD ["node", "apps/server/src/main.ts"]
