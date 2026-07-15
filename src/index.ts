import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startHttpServer } from './httpServer';
import { createMcpServer, typedToolCount } from './server';

// ---------------------------------------------------------------------------
// Validate required env vars
// ---------------------------------------------------------------------------

const REQUIRED_ENV = ['GOVC_URL', 'GOVC_USERNAME', 'GOVC_PASSWORD'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);

if (missing.length) {
  console.error(`✗ Missing required env vars: ${missing.join(', ')}`);
  console.error('  Set GOVC_URL, GOVC_USERNAME, GOVC_PASSWORD (and optionally GOVC_INSECURE=true)');
  process.exit(1);
}

console.error('✓ govc credentials configured');

// ---------------------------------------------------------------------------
// Main — transport selected via MCP_TRANSPORT (stdio | http, default stdio)
// ---------------------------------------------------------------------------

async function main() {
  const transportMode = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();

  if (transportMode === 'http') {
    startHttpServer();
    return;
  }

  if (transportMode !== 'stdio') {
    console.error(`✗ Unknown MCP_TRANSPORT: "${transportMode}" (expected "stdio" or "http")`);
    process.exit(1);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`VMWare MCP server running on stdio (${typedToolCount} typed tools + 3 meta tools)`);
  // Only start the health-check for the main container process (PID 1).
  // Exec'd processes would fail to bind the port anyway.
  if (process.pid === 1) {
    startHttpServer({ healthOnly: true });
  }

  // The MCP SDK's StdioServerTransport does not handle stdin EOF,
  // so we listen directly. Without this the health-check server
  // keeps the event loop alive and the container never exits.
  //
  // In persistent mode (MCP_KEEP_ALIVE=true), the main container process
  // (PID 1) stays alive so clients can `docker exec` into it.
  // Exec'd processes are never PID 1, so they always exit on stdin EOF.
  const keepAlive = process.env.MCP_KEEP_ALIVE === 'true' || process.env.MCP_KEEP_ALIVE === '1';

  if (keepAlive && process.pid === 1) {
    console.error('Persistent mode — waiting for connections via `docker exec`');
  } else {
    process.stdin.on('end', () => {
      console.error('stdin closed, shutting down…');
      process.exit(0);
    });
  }
}

main().catch(console.error);
