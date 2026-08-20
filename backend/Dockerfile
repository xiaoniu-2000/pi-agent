# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM dependencies AS builder
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=30142 \
    PI_WEB_AUTH_ENABLED=1 \
    PI_WEB_SELF_REGISTRATION_ENABLED=1 \
    PI_CODING_AGENT_DIR=/data/pi-agent \
    PI_WEB_USER_DATA_ROOT=/data/users

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /data/pi-agent/extensions /data/users \
    && chown -R node:node /app /data

WORKDIR /app
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/scripts/manage-web-user.mjs ./scripts/manage-web-user.mjs
# Pi Agent loads these JSON files dynamically; Next.js standalone tracing misses them.
COPY --from=builder --chown=node:node \
    /app/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme \
    ./node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme

RUN test -f /app/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json \
    && test -f /app/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/light.json \
    && test -f /app/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json
USER node
EXPOSE 30142
VOLUME ["/data/pi-agent", "/data/users"]
CMD ["node", "server.js"]
