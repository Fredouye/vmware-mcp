import { timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer, typedToolCount } from './server';

/**
 * HTTP server exposing:
 *
 * - `POST /mcp`     — MCP Streamable HTTP endpoint (stateless mode).
 * - `GET  /healthz` — liveness probe for container orchestrators (Docker, K8s).
 *
 * Stateless mode: a fresh Server + transport pair is created per request
 * (the SDK-recommended pattern — it avoids request-ID collisions between
 * concurrent clients). No sessions, no server→client streams, so GET and
 * DELETE on /mcp are rejected with 405.
 *
 * Auth: a Bearer token (`MCP_AUTH_TOKEN`) is required on /mcp — the tools
 * hand out full vSphere control, so the server refuses to start without one.
 *
 * With `healthOnly: true` only /healthz is served — used as liveness probe
 * for legacy stdio persistent containers.
 */

const MCP_PATH = '/mcp';
const HEALTH_PATH = '/healthz';

const isAuthorized = (req: IncomingMessage, token: string): boolean => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};

const sendJsonRpcError = (
  res: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {},
) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
};

const handleMcpRequest = async (req: IncomingMessage, res: ServerResponse, allowedHosts: string[]) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true,
    ...(allowedHosts.length > 0 && { enableDnsRebindingProtection: true, allowedHosts }),
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
};

export interface HttpServerOptions {
  healthOnly?: boolean;
}

export const startHttpServer = ({ healthOnly = false }: HttpServerOptions = {}) => {
  const port = parseInt(process.env.HTTP_PORT || '3211', 10);
  const host = process.env.HTTP_HOST || '127.0.0.1';
  const token = process.env.MCP_AUTH_TOKEN;
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  if (!healthOnly && !token) {
    console.error('✗ MCP_AUTH_TOKEN is required in HTTP mode — the MCP endpoint grants full vSphere control.');
    console.error('  Generate one with e.g.: openssl rand -hex 32');
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    const path = (req.url || '').split('?')[0];

    if (path === HEALTH_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (healthOnly || path !== MCP_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }

    if (req.method !== 'POST') {
      // Stateless mode: no SSE stream to GET, no session to DELETE.
      sendJsonRpcError(res, 405, 'Method not allowed.', { Allow: 'POST' });
      return;
    }

    if (!token || !isAuthorized(req, token)) {
      sendJsonRpcError(res, 401, 'Unauthorized.', { 'WWW-Authenticate': 'Bearer' });
      return;
    }

    try {
      await handleMcpRequest(req, res, allowedHosts);
    } catch (err) {
      console.error(`✗ Error handling MCP request: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, 'Internal server error.');
      } else {
        res.end();
      }
    }
  });

  server.listen(port, host, () => {
    if (healthOnly) {
      console.error(`Http health-check server running on http://${host}:${port}${HEALTH_PATH}`);
    } else {
      console.error(
        `VMWare MCP server running on http://${host}:${port}${MCP_PATH} (${typedToolCount} typed tools + 3 meta tools)`,
      );
    }
  });

  server.on('error', (err) => {
    console.error(`✗ HTTP server failed to start: ${err.message}`);
    if (!healthOnly) process.exit(1);
  });
};
