# VMWare MCP

An [MCP](https://modelcontextprotocol.io/) server that gives AI agents direct access to your VMware vSphere infrastructure. Built on top of [`govc`](https://github.com/vmware/govmomi/tree/main/govc), it exposes **55 typed tools** covering VM lifecycle, snapshots, datastores, networking, and more — with additional tools being added over time.

Tool output is formatted in [TOON](https://github.com/toon-format/spec) for token-efficient LLM consumption, with automatic JSON fallback.

## Available Tools

| Category                  | Tools                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Navigation**            | `about`, `ls`, `find`, `tree`, `events`, `tasks`, `logs`, `logs.ls`                                                                                                                                                          |
| **VM Lifecycle**          | `vm.create`, `vm.clone`, `vm.instantclone`, `vm.destroy`, `vm.register`, `vm.unregister`, `vm.upgrade`                                                                                                                       |
| **VM Configuration**      | `vm.change`, `vm.customize`, `vm.info`, `vm.ip`, `vm.power`, `vm.migrate`, `vm.vnc`, `vm.question`                                                                                                                           |
| **VM Disks**              | `vm.disk.create`, `vm.disk.attach`, `vm.disk.change`, `vm.disk.promote`                                                                                                                                                      |
| **VM Networking**         | `vm.network.add`, `vm.network.change`                                                                                                                                                                                        |
| **VM Options & Policies** | `vm.option.info`, `vm.option.ls`, `vm.policy.ls`, `vm.target.info`, `vm.target.cap.ls`, `vm.guest.tools`                                                                                                                     |
| **Snapshots**             | `snapshot.create`, `snapshot.remove`, `snapshot.export`, `snapshot.tree`                                                                                                                                                     |
| **Datastore**             | `datastore.info`, `datastore.ls`, `datastore.cp`, `datastore.mv`, `datastore.tail`, `datastore.disk.info`, `datastore.cluster.info`, `datastore.cluster.change`, `datastore.maintenance.enter`, `datastore.maintenance.exit` |
| **Session**               | `session.login`, `session.logout`, `session.ls`, `session.rm`                                                                                                                                                                |
| **vSAN**                  | `vsan.info`                                                                                                                                                                                                                  |
| **Task**                  | `task.cancel`                                                                                                                                                                                                                |

Plus **3 meta tools**: `govc_search` (fuzzy search across all commands), `govc_help` (get help for any command), and `govc_run` (escape hatch for any govc command).

First, copy and fill in your credentials:

```bash
cp .env.docker.example .env.docker   # edit with your vCenter URL, username & password
```

## Quick Start — HTTP (recommended for containers)

The image defaults to the MCP [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http) transport on port `3211`. Unlike stdio — where each client spawns its own container — a single HTTP server is shared by any number of clients and machines, survives client restarts, and needs no Docker access from the client side.

A Bearer token is **required** (`MCP_AUTH_TOKEN` in `.env.docker` — generate one with `openssl rand -hex 32`): the tools grant full vSphere control, so the server refuses to start without it.

```bash
# Docker (once)
docker run -d --name vmware-mcp --restart unless-stopped \
  --env-file .env.docker -p 127.0.0.1:3211:3211 fredouye/vmware-mcp:latest

# Claude Code
claude mcp add --transport http vmware-mcp http://127.0.0.1:3211/mcp \
  --header "Authorization: Bearer <your MCP_AUTH_TOKEN>"
```

Or in JSON client config:

```json
{
  "mcpServers": {
    "vmware-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:3211/mcp",
      "headers": { "Authorization": "Bearer <your MCP_AUTH_TOKEN>" }
    }
  }
}
```

The server is stateless (no sessions), so it survives restarts and works behind load balancers. `GET /healthz` is an unauthenticated liveness probe. Only publish the port beyond localhost behind TLS (nginx/caddy reverse proxy); set `MCP_ALLOWED_HOSTS` to enable DNS-rebinding protection when exposed on a LAN.

### Docker Compose

The repo ships a `docker-compose.yml` that builds the image from source and publishes the port on localhost only:

```bash
cp .env.docker.example .env.docker   # fill in GOVC_* credentials and MCP_AUTH_TOKEN
docker compose up -d --build
```

To customize (expose on the LAN, add `extra_hosts` for a vCenter not resolvable from the container, …), put your overrides in a `docker-compose.override.yml` — it is merged automatically and stays out of git.

## Quick Start — stdio, Ephemeral

A fresh container per connection, removed when done.

```bash
# Docker
docker run --rm -i -e MCP_TRANSPORT=stdio --env-file .env.docker fredouye/vmware-mcp:latest

# Claude Code
claude mcp add vmware-mcp -- docker run --rm -i -e MCP_TRANSPORT=stdio --env-file .env.docker fredouye/vmware-mcp:latest
```

## Quick Start — stdio, Persistent

The container runs as a long-lived service. Clients connect via `docker exec`.

```bash
# Docker (once)
docker run -d --name vmware-mcp --restart unless-stopped \
  --env-file .env.docker -e MCP_TRANSPORT=stdio -e MCP_KEEP_ALIVE=true fredouye/vmware-mcp:latest

# Claude Code
claude mcp add vmware-mcp -- docker exec -i -e MCP_TRANSPORT=stdio vmware-mcp vmware-mcp
```

> Restart Claude Code after running `claude mcp add`. Tools appear as `mcp__vmware-mcp__*`. Check status with `/mcp`.

## Quick Start — From Source

```bash
git clone https://github.com/Fredouye/vmware-mcp.git
cd vmware-mcp
bun install
cp .env.example .env  # fill in your credentials
bun run start          # run the MCP server over stdio
```

To explore and test tools interactively, you can use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) instead:

```bash
bun run ui
```

## Configuration

| Variable          | Required | Description                                                     |
| ----------------- | -------- | --------------------------------------------------------------- |
| `GOVC_URL`        | ✅       | vCenter / ESXi SDK URL (e.g. `https://vcenter.example.com/sdk`) |
| `GOVC_USERNAME`   | ✅       | vSphere username                                                |
| `GOVC_PASSWORD`   | ✅       | vSphere password                                                |
| `GOVC_INSECURE`   |          | Set `1` to skip TLS verification                                |
| `GOVC_BIN`        |          | Path to `govc` binary (default: `govc`)                         |
| `GOVC_TIMEOUT_MS` |          | Subprocess timeout in ms (default: `120000`)                    |
| `MCP_TRANSPORT`   |          | `stdio` (default from source) or `http` (default in the Docker image) |
| `MCP_AUTH_TOKEN`  | (http)   | Bearer token required on `POST /mcp` — the server refuses to start in HTTP mode without it |
| `HTTP_HOST`       |          | HTTP bind address (default `127.0.0.1`; `0.0.0.0` in the Docker image) |
| `HTTP_PORT`       |          | HTTP port for `/mcp` and `/healthz` (default `3211`)            |
| `MCP_ALLOWED_HOSTS` |        | Comma-separated `Host` header allowlist — enables DNS-rebinding protection |
| `MCP_KEEP_ALIVE`  |          | stdio mode only: set `true` for persistent container mode (see above) |

## SSH Tunnel

If vCenter is only reachable through an internal network:

```bash
ssh [-J jump_user@jump_host] -L 8443:vcenter_host:443 user@internal_host -N
```

Then use `GOVC_URL=https://localhost:8443/sdk` with `GOVC_INSECURE=1`.

---

## Development

### Prerequisites

- [Bun](https://bun.sh/) ≥ 1.0
- [govc](https://github.com/vmware/govmomi/tree/main/govc) in `PATH`

### Scripts

| Script                    | Description                      |
| ------------------------- | -------------------------------- |
| `bun run start`           | Run MCP server (stdio)           |
| `bun run dev`             | Run with `--watch`               |
| `bun run ui`              | Launch MCP Inspector (web UI)    |
| `bun run check`           | Biome + tsc (CI gate)            |
| `bun run docker:build`    | Build Docker image (native arch) |
| `bun run docker:build:ci` | Build Docker image (linux/amd64) |

### Adding a Command

1. Add entry to `GOVC_COMMAND_INDEX` in `src/commands.ts`.
2. Add `GovcToolDef` to `GOVC_TOOL_DEFS` with typed flags.
3. Generator wires it automatically.
4. `bun run check`.

## License

MIT
