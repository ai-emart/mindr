FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/cli/package.json packages/cli/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @ai-emart/mindr-core build \
  && pnpm --filter @ai-emart/mindr build \
  && pnpm --filter mindr build

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app /app

ENTRYPOINT ["node", "/app/packages/cli/dist/cli.js"]
CMD ["--help"]
