# Podium Voices agent: Node + Playwright Chromium for Jitsi browser bot.
# Production: inject PODIUM_TOKEN via secret manager or env at runtime; never bake secrets into image.
# See docs/TOKEN_ROTATION_SOP.md and README.

# Stage 1: build (need devDependencies for tsc)
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY bot-page ./bot-page
COPY personas ./personas
COPY assets ./assets
RUN npm run build

# Stage 2: production image
FROM node:20-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY scripts ./scripts
COPY bot-page ./bot-page

# Chromium + system deps (see https://playwright.dev/docs/docker)
RUN npx playwright install chromium --with-deps

# Default: run the agent. Override CMD for coordinator: node dist/coordinator/index.js
CMD ["node", "dist/main.js"]
