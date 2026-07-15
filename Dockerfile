# Stage 1: Download govc for the correct architecture
FROM alpine:3.24 AS govc-builder
ARG GOVC_VERSION=0.55.1
RUN apk add --no-cache curl && \
    ARCH=$(uname -m | sed 's/aarch64/arm64/' | sed 's/x86_64/x86_64/') && \
    curl -fsSL "https://github.com/vmware/govmomi/releases/download/v${GOVC_VERSION}/govc_Linux_${ARCH}.tar.gz" \
    | tar xzf - -C /usr/local/bin govc && \
    chmod +x /usr/local/bin/govc

# Stage 2: Install dependencies
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src/ ./src/

# Stage 3: Runtime
FROM oven/bun:1-alpine
WORKDIR /app

COPY --from=govc-builder /usr/local/bin/govc /usr/local/bin/govc
COPY --from=builder /app ./

# MCP server entrypoint — used by all modes
RUN printf '#!/bin/sh\nexec bun run /app/src/index.ts\n' > /usr/local/bin/vmware-mcp && \
    chmod +x /usr/local/bin/vmware-mcp

# Default to the Streamable HTTP transport, listening on all interfaces
# (the container network namespace provides the boundary; MCP_AUTH_TOKEN
# is still required). Override MCP_TRANSPORT=stdio for the legacy modes.
ENV MCP_TRANSPORT=http \
    HTTP_HOST=0.0.0.0 \
    HTTP_PORT=3211

EXPOSE 3211

ENTRYPOINT ["vmware-mcp"]