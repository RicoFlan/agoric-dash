# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22.21.1
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Next.js"

# Next.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base AS build

# Inlined into the client bundle for setup hints. fly.toml sets this for Fly.io Docker builds.
ARG NEXT_PUBLIC_DASHBOARD_HOSTING=
ENV NEXT_PUBLIC_DASHBOARD_HOSTING=$NEXT_PUBLIC_DASHBOARD_HOSTING

# Reduce Node OOM during npm/next build on constrained builders (e.g. Fly remote builder).
ENV NODE_OPTIONS="--max-old-space-size=6144"

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install node modules
COPY package-lock.json package.json ./
RUN npm ci --include=dev

# Copy application code
COPY . .

# Compile then generate while devDependencies still exist. Runtime image runs `next start` only
# (see docker-entrypoint.js); running `next build` at boot after `npm prune` drops typescript/tailwind
# and forces npx to fetch tooling on a small VM → missing deps / OOM.
RUN npx next build --experimental-build-mode compile && \
    npx next build --experimental-build-mode generate

# Remove development dependencies
RUN npm prune --omit=dev


# Final stage for app image
FROM base

# Match Fly `http_service.internal_port`; without PORT, Next listens on 3000 and the proxy gets PC01.
ENV PORT="8080"

# Copy built application
COPY --from=build /app /app

# Entrypoint sets up the container.
ENTRYPOINT [ "/app/docker-entrypoint.js" ]

# Start the server by default, this can be overwritten at runtime
EXPOSE 8080
CMD [ "npm", "run", "start" ]
