# Test image: Node 24, git, and the dependencies of package-lock.json. Built with network, the tests run without it.
FROM node:24-bookworm-slim
ENV NPM_CONFIG_CACHE=/opt/npm-cache \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates procps openssh-client gnupg python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN chmod -R a+rX /opt /deps
