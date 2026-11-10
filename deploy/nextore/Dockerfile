# NexTore Designer — OCI image (NXD-D35).
#
# Differences from ../Dockerfile (the upstream image):
#   * Debian slim instead of Alpine: the pinned opencode CLI and bubblewrap are
#     glibc/kernel-facing, and the sandbox path is Linux-only.
#   * bubblewrap is installed and OD_SANDBOX defaults to bwrap, so edition runs
#     are confined (see apps/daemon/src/sandbox/).
#   * The vendored offline asset set (apps/daemon/vendor) is copied in; without
#     it /vendor/* answers 503 and generated previews fall back to remote hosts.
#   * The process runs as an unprivileged user; the compose file adds the seccomp
#     profile bwrap needs to create namespaces.
ARG NODE_IMAGE=docker.io/library/node:24-bookworm-slim
ARG RUNTIME_IMAGE=docker.io/library/node:24-bookworm-slim
# Pinned so every image ships the runtime the mocks and acceptance fixtures were
# recorded against (see mocks/README.md). Bump deliberately, with a fresh replay.
ARG OPENCODE_VERSION=1.18.18

FROM ${NODE_IMAGE} AS build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG NO_PROXY

ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${http_proxy}
ENV https_proxy=${https_proxy}
ENV no_proxy=${no_proxy}
ENV NO_PROXY=${NO_PROXY}
ENV CI=true

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY packages ./packages
COPY tools ./tools
COPY apps/daemon/package.json ./apps/daemon/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
RUN corepack enable && \
    corepack prepare pnpm@10.33.2 --activate && \
    pnpm install --frozen-lockfile

COPY apps ./apps
RUN pnpm --filter @open-design/daemon build && \
    pnpm --filter @open-design/web build && \
    pnpm --filter @open-design/daemon deploy --legacy --prod /app/deploy/daemon && \
    pnpm store prune && \
    rm -rf \
      /root/.cache \
      /root/.local/share/pnpm/store \
      /app/deploy/daemon/node_modules/.cache \
      /app/deploy/daemon/node_modules/@types \
      /app/deploy/daemon/node_modules/.pnpm/@types+* && \
    find /app/deploy/daemon/node_modules -type d \( \
      -name test -o \
      -name tests -o \
      -name "__tests__" -o \
      -name docs -o \
      -name doc -o \
      -name example -o \
      -name examples -o \
      -name ".github" \
    \) -prune -exec rm -rf '{}' + && \
    find /app/deploy/daemon/node_modules -type f \( \
      -name "*.md" -o \
      -name "*.markdown" -o \
      -name "*.d.ts" -o \
      -name "*.d.cts" -o \
      -name "*.d.mts" -o \
      -name "*.map" -o \
      -name "*.tsbuildinfo" -o \
      -name "binding.gyp" \
    \) -delete

COPY skills ./skills
COPY design-systems ./design-systems
COPY craft ./craft
COPY prompt-templates ./prompt-templates
COPY assets ./assets
COPY data ./data
COPY plugins/_official ./plugins/_official

FROM ${RUNTIME_IMAGE}

ARG OPENCODE_VERSION

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bubblewrap \
      ca-certificates \
      git \
      poppler-utils \
      tini && \
    rm -rf /var/lib/apt/lists/* && \
    npm install --global --omit=dev opencode-ai@${OPENCODE_VERSION} && \
    npm cache clean --force && \
    groupadd --system --gid 10001 designer && \
    useradd --system --uid 10001 --gid designer --create-home --home-dir /home/designer designer

WORKDIR /app
COPY --from=build --chown=designer:designer /app/LICENSE /app/NOTICE ./
COPY --from=build --chown=designer:designer /app/deploy/daemon ./apps/daemon
COPY --from=build --chown=designer:designer /app/apps/daemon/vendor ./apps/daemon/vendor
COPY --from=build --chown=designer:designer /app/apps/web/out ./apps/web/out
COPY --from=build --chown=designer:designer /app/skills ./skills
COPY --from=build --chown=designer:designer /app/design-systems ./design-systems
COPY --from=build --chown=designer:designer /app/craft ./craft
COPY --from=build --chown=designer:designer /app/prompt-templates ./prompt-templates
COPY --from=build --chown=designer:designer /app/data ./data
COPY --from=build --chown=designer:designer /app/assets/frames ./assets/frames
COPY --from=build --chown=designer:designer /app/assets/community-pets ./assets/community-pets
COPY --from=build --chown=designer:designer /app/plugins/_official ./plugins/_official

# The daemon data root is supplied at run time (OD_DATA_DIR) and must be a
# mounted volume; nothing user-owned lives in the image layers.
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=512
ENV OD_BIND_HOST=0.0.0.0
ENV OD_PORT=7456
ENV OD_EDITION=nextore
ENV OD_SANDBOX=bwrap
ENV OD_BWRAP_BIN=/usr/bin/bwrap
ENV OPENCODE_BIN=/usr/local/bin/opencode

EXPOSE 7456

USER designer
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/daemon/dist/cli.js", "--no-open"]
