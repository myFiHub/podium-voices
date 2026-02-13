# Podium Voices agent: Node + Playwright Chromium for Jitsi browser bot.
# Production: inject PODIUM_TOKEN via secret manager or env at runtime; never bake secrets into image.
# See docs/TOKEN_ROTATION_SOP.md and README.

FROM node:20-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY bot-page ./bot-page
COPY personas ./personas
COPY assets ./assets

RUN npm run build

# Chromium + system deps (see https://playwright.dev/docs/docker)
RUN npx playwright install chromium --with-deps

# Default: run the agent. Override CMD for coordinator: node dist/coordinator/index.js
CMD ["node", "dist/main.js"]
