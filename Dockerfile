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
COPY packages/ui-icons/package.json packages/ui-icons/
COPY packages/service-kit/package.json packages/service-kit/
COPY services/auth/package.json services/auth/
COPY services/content/package.json services/content/
COPY services/quiz/package.json services/quiz/
COPY services/ai-gateway/package.json services/ai-gateway/
COPY packages/scoring/package.json packages/scoring/
COPY packages/fsrs/package.json packages/fsrs/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

# ---- auth service ----
FROM source AS auth-build
RUN pnpm --filter @ultimyr/auth build \
 && pnpm --filter @ultimyr/auth deploy --prod /out/auth

FROM node:22-slim AS auth
ENV NODE_ENV=production
WORKDIR /app
COPY --from=auth-build /out/auth/node_modules ./node_modules
COPY --from=auth-build /repo/services/auth/dist ./dist
COPY --from=auth-build /repo/services/auth/migrations ./migrations
USER node
EXPOSE 4001
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- content service ----
FROM source AS content-build
RUN pnpm --filter @ultimyr/content build \
 && pnpm --filter @ultimyr/content deploy --prod /out/content

FROM node:22-slim AS content
ENV NODE_ENV=production
WORKDIR /app
COPY --from=content-build /out/content/node_modules ./node_modules
COPY --from=content-build /repo/services/content/dist ./dist
COPY --from=content-build /repo/services/content/migrations ./migrations
USER node
EXPOSE 4002
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4002/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- quiz service ----
FROM source AS quiz-build
RUN pnpm --filter @ultimyr/quiz build \
 && pnpm --filter @ultimyr/quiz deploy --prod /out/quiz

FROM node:22-slim AS quiz
ENV NODE_ENV=production
WORKDIR /app
COPY --from=quiz-build /out/quiz/node_modules ./node_modules
COPY --from=quiz-build /repo/services/quiz/dist ./dist
COPY --from=quiz-build /repo/services/quiz/migrations ./migrations
USER node
EXPOSE 4003
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4003/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- ai-gateway service ----
FROM source AS ai-build
RUN pnpm --filter @ultimyr/ai-gateway build \
 && pnpm --filter @ultimyr/ai-gateway deploy --prod /out/ai

FROM node:22-slim AS ai-gateway
ENV NODE_ENV=production
WORKDIR /app
COPY --from=ai-build /out/ai/node_modules ./node_modules
COPY --from=ai-build /repo/services/ai-gateway/dist ./dist
COPY --from=ai-build /repo/services/ai-gateway/migrations ./migrations
USER node
EXPOSE 4004
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4004/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- migrate: one-shot job that applies every service's migrations ----
FROM source AS migrate-build
RUN pnpm --filter @ultimyr/db build \
 && pnpm --filter @ultimyr/db deploy --prod /out/db

FROM node:22-slim AS migrate
ENV NODE_ENV=production ULTIMYR_ROOT=/app
WORKDIR /app
COPY --from=migrate-build /out/db/node_modules ./node_modules
COPY --from=migrate-build /repo/packages/db/dist ./dist
COPY --from=migrate-build /repo/services/auth/migrations ./services/auth/migrations
COPY --from=migrate-build /repo/services/content/migrations ./services/content/migrations
COPY --from=migrate-build /repo/services/quiz/migrations ./services/quiz/migrations
COPY --from=migrate-build /repo/services/ai-gateway/migrations ./services/ai-gateway/migrations
USER node
CMD ["node", "dist/migrate-cli.js"]

# ---- web ----
FROM source AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
# next.config rewrites are fixed at build time: this is where the web app forwards /api/v1.
ARG AUTH_URL=http://auth:4001
ARG CONTENT_URL=http://content:4002
ARG QUIZ_URL=http://quiz:4003
ARG AI_URL=http://ai-gateway:4004
ENV AUTH_URL=$AUTH_URL CONTENT_URL=$CONTENT_URL QUIZ_URL=$QUIZ_URL AI_URL=$AI_URL
RUN pnpm --filter @ultimyr/web build

FROM node:22-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build /repo/apps/web/.next/standalone ./
COPY --from=web-build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
