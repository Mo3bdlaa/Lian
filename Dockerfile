# Lian, as one image, for arm64.
#
# There is no build step: Node 22 runs the TypeScript directly, so this copies
# source and installs production dependencies. Nothing is bundled, nothing is
# transpiled, and what runs in production is the file you read.
#
# The same image runs both processes — the web server and the external ticker
# (Q16) — selected by the command. They are separate on purpose: a schedule
# that lives inside the web process dies with it.
#
# ── WHY NOTHING IS ENUMERATED HERE ─────────────────────────────────────────
#
# The version of this file before it was ever built listed fifteen workspace
# packages by hand, one COPY line each. Four had been added since it was
# written — billing, email, geo, storage — so `npm ci` failed on a workspace
# it could not resolve, and THE IMAGE HAD NEVER BUILT. Not "was broken by a
# change": had never worked, in a repository with 780 tests and sixteen gates.
#
# So the manifest stage below derives the list from the tree instead of
# repeating it. A package added tomorrow is picked up with no edit here, which
# is the only version of this that stays true (LESSONS §20, §23).
#
# ── WHY ARM64 ──────────────────────────────────────────────────────────────
#
# The target is an Oracle Cloud Always Free Ampere A1 — 2 OCPU, 12 GB, arm64.
# There are ZERO native dependencies in this tree (`pg` and the Anthropic SDK
# are both pure JavaScript, and nothing has an install script), which is why
# this is a normal Dockerfile rather than a cross-compilation problem.
# `tools/gates/no-native-deps.ts` keeps it that way.

# ── BEHIND A TLS-INTERCEPTING PROXY ────────────────────────────────────────
#
# `npm ci` inside a container has no reason to trust a corporate or sandbox
# proxy's certificate, and fails with SELF_SIGNED_CERT_IN_CHAIN — which npm
# reports as "Exit handler never called!", an error about npm rather than
# about TLS, which is how an hour goes missing. If that is your network:
#
#   docker build --secret id=proxy_ca,src=/path/to/ca-bundle.crt .
#
# It is a build secret rather than a COPY so the certificate never lands in a
# layer, and it is optional: without it the two `npm ci` lines behave exactly
# as they would anywhere else.

# ── manifests: the package.json files, and nothing else ────────────────────
#
# Copied whole and then stripped, rather than listed. BuildKit caches COPY
# --from on the CONTENT that comes across, so the expensive `npm ci` below is
# reused whenever the set of manifests is unchanged — which is what the
# hand-written list was trying to buy, without the going-stale.
FROM --platform=$BUILDPLATFORM node:22-alpine AS manifests
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN find packages apps -mindepth 2 -type f ! -name package.json -delete \
 && find packages apps -mindepth 2 -type d -empty -delete

# ── deps: production dependencies only, installed on the BUILD platform ────
#
# `--platform=$BUILDPLATFORM` — installed on whatever is building, then copied
# into the arm64 image. That is only sound because **`node_modules` here
# contains no compiled code**: no `.node` binaries, no prebuilds, no install
# scripts, nothing whose contents depend on the architecture.
# `tools/gates/no-native-deps.ts` is what keeps that true, and it is the
# licence for this line. Remove one and the other has to go too.
#
# The gain is time: dependency resolution under qemu is several times slower
# than native, and on the target box the build is competing with the running
# product for 2 OCPUs.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY --from=manifests /src/package.json /src/package-lock.json ./
COPY --from=manifests /src/packages ./packages
COPY --from=manifests /src/apps ./apps
# `npm ci` is exact, and --omit=dev keeps typescript and @types out of an
# image that never compiles anything.
RUN --mount=type=secret,id=proxy_ca,target=/tmp/proxy-ca.crt \
    sh -euc 'if [ -s /tmp/proxy-ca.crt ]; then export NODE_EXTRA_CA_CERTS=/tmp/proxy-ca.crt; fi; \
             npm ci --omit=dev && npm cache clean --force'

# ── devdeps: everything, for the test stage ────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-alpine AS devdeps
WORKDIR /app
COPY --from=manifests /src/package.json /src/package-lock.json ./
COPY --from=manifests /src/packages ./packages
COPY --from=manifests /src/apps ./apps
RUN --mount=type=secret,id=proxy_ca,target=/tmp/proxy-ca.crt \
    sh -euc 'if [ -s /tmp/proxy-ca.crt ]; then export NODE_EXTRA_CA_CERTS=/tmp/proxy-ca.crt; fi; npm ci'

# ── test: the suite, inside the image, on the target architecture ──────────
#
# A separate stage so the runtime image carries none of it. This is what
# `npm run docker:test` runs, and it is the only way to know the product works
# on arm64 rather than that it compiles for arm64.
FROM node:22-alpine AS test
WORKDIR /app
ENV NODE_ENV=test
# Dev dependencies too, installed on the build platform for the same reason
# and with the same licence as `deps` above.
COPY --from=devdeps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools
COPY design-system ./design-system
# The docs are TESTED — tools/accounts.test.ts reads ACCOUNTS.md and checks
# every environment variable it names is one the config actually reads. Left
# out of this stage the suite fails on arm64 for a reason that has nothing to
# do with arm64, which is exactly what happened the first time.
COPY docs ./docs
COPY tsconfig.json tsconfig.base.json ./
CMD ["npm", "run", "test:ci"]

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The heap, set deliberately rather than by default. See docs/DEPLOY.md — on a
# 12 GB box shared with Postgres-less services this is generous, and the
# reason to name it at all is that Node's default is a fraction of the box on
# a large machine and all of it on a small one, so "the default" is not a
# number anybody has decided.
ENV NODE_OPTIONS="--max-old-space-size=1024"

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools
# The colour tokens are read at runtime for the manifest and theme-color;
# without this the manifest has no colour and an installed app flashes white.
COPY design-system ./design-system

# NOT ROOT. `node` exists in the official image with uid 1000; nothing here
# writes to the filesystem, so it needs nothing more than read.
USER node

EXPOSE 8787

# Liveness, from inside the container, so an orchestrator can restart a
# process that is up but wedged. `/health/live` deliberately does NOT touch
# the database — see apps/server/src/health.ts for why a liveness probe that
# checks a dependency restarts the wrong thing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run at boot (they are idempotent), then the server serves.
CMD ["node", "apps/server/src/main.ts"]
