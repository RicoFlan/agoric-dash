# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.21.1

FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS build
ENV NODE_OPTIONS=--max-old-space-size=6144
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

COPY package-lock.json package.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build && npm prune --omit=dev

FROM base
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "start"]
