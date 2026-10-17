# syntax=docker/dockerfile:1.7
# One Dockerfile, one target per deployable. Build with: docker build --target <name> .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# ---- deps: install the whole workspace once; layers cache on the lockfile ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/authz/package.json packages/authz/
COPY packages/lore/package.json packages/lore/
COPY packages/coverage/package.json packages/coverage/
COPY packages/tagging/package.json packages/tagging/
COPY packages/bundle/package.json packages/bundle/
COPY packages/ui-icons/package.json packages/ui-icons/
COPY packages/service-kit/package.json packages/service-kit/
COPY apps/api/package.json apps/api/
COPY services/auth/package.json services/auth/
COPY services/content/package.json services/content/
COPY services/quiz/package.json services/quiz/
COPY services/ai-gateway/package.json services/ai-gateway/
COPY services/mcp/package.json services/mcp/
COPY services/notes/package.json services/notes/
COPY packages/scoring/package.json packages/scoring/
COPY packages/fsrs/package.json packages/fsrs/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

# ---- api: auth, content, quiz, ai-gateway, notes and mcp in one container ----
# Each service is still its own package, built to its own bundle (services/<name>/dist/main.js). The api launcher applies
# every service's migrations, then runs each bundle as a separate process and restarts any that exits.
FROM source AS api-build
# Set by CI for published images (the build context has no .git). Shown in Admin > About.
ARG ULTIMYR_COMMIT=""
ARG ULTIMYR_VERSION=""
ENV ULTIMYR_COMMIT=$ULTIMYR_COMMIT ULTIMYR_VERSION=$ULTIMYR_VERSION
RUN pnpm --filter "./services/*" --filter @ultimyr/api build \
 && pnpm --filter @ultimyr/api deploy --prod /out/api

FROM node:22-slim AS api
ENV NODE_ENV=production ULTIMYR_ROOT=/app
WORKDIR /app
COPY --from=api-build /out/api/node_modules ./node_modules
COPY --from=api-build /repo/apps/api/dist ./dist
COPY --from=api-build /repo/services/auth/dist ./services/auth/dist
COPY --from=api-build /repo/services/content/dist ./services/content/dist
COPY --from=api-build /repo/services/quiz/dist ./services/quiz/dist
COPY --from=api-build /repo/services/ai-gateway/dist ./services/ai-gateway/dist
COPY --from=api-build /repo/services/notes/dist ./services/notes/dist
COPY --from=api-build /repo/services/mcp/dist ./services/mcp/dist
COPY --from=api-build /repo/services/auth/migrations ./services/auth/migrations
COPY --from=api-build /repo/services/content/migrations ./services/content/migrations
COPY --from=api-build /repo/services/quiz/migrations ./services/quiz/migrations
COPY --from=api-build /repo/services/ai-gateway/migrations ./services/ai-gateway/migrations
COPY --from=api-build /repo/services/notes/migrations ./services/notes/migrations
USER node
EXPOSE 4000 4001 4002 4003 4004 4005 4006
# Healthy only when every service answers (the launcher reports 503 with each service's state otherwise).
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- web ----
FROM source AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
# next.config rewrites are fixed at build time: this is where the web app forwards /api/v1.
ARG AUTH_URL=http://api:4001
ARG CONTENT_URL=http://api:4002
ARG QUIZ_URL=http://api:4003
ARG AI_URL=http://api:4004
ARG MCP_URL=http://api:4005
ARG NOTES_URL=http://api:4006
ENV AUTH_URL=$AUTH_URL CONTENT_URL=$CONTENT_URL QUIZ_URL=$QUIZ_URL AI_URL=$AI_URL MCP_URL=$MCP_URL NOTES_URL=$NOTES_URL
RUN pnpm --filter @ultimyr/web build

FROM node:22-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build /repo/apps/web/.next/standalone ./
COPY --from=web-build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
