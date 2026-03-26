# SAP Help MCP — Cloud Foundry Deployment

## Goal

Make sap-help-mcp deployable on SAP BTP Cloud Foundry by adding an HTTP transport entrypoint alongside the existing stdio entrypoint.

## Decisions

- **Separate entrypoints:** `src/index.ts` (stdio, local) and `src/server.ts` (HTTP, CF). Shared MCP server logic extracted to `src/mcp-server.ts`.
- **Transport:** `StreamableHTTPServerTransport` from MCP SDK v1.28.0 in stateless mode (no session persistence).
- **HTTP framework:** Express — lightweight, standard for CF Node.js buildpack.
- **Auth:** None. Relies on CF network isolation.
- **Port:** `process.env.PORT` (CF-assigned) or `8080` default.

## File Changes

### New Files

#### `src/mcp-server.ts` — MCP Server Factory

Extracts the MCP `Server` creation and tool/handler registration from `src/index.ts` into a reusable factory function:

```ts
export function createMcpServer(): Server
```

Returns a fully configured `Server` instance with all four tools registered (`sap_help_search`, `sap_help_semantic_search`, `sap_help_list_products`, `sap_help_get_page`). The `SapHelpClient` instance and all formatting functions live in this module.

#### `src/server.ts` — HTTP Entrypoint

Express app with three routes:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Health check — returns `{ status: "ok" }` |
| `POST` | `/mcp` | MCP JSON-RPC request handling |
| `GET` | `/mcp` | SSE stream for server-initiated messages |
| `DELETE` | `/mcp` | Session termination |

Each `POST /mcp` request creates a new `StreamableHTTPServerTransport` (stateless — `sessionIdGenerator` set to `undefined`). The transport is connected to a fresh `Server` instance from the factory.

Startup:
```ts
const port = parseInt(process.env.PORT || "8080", 10);
app.listen(port, () => console.log(`sap-help-mcp HTTP server on port ${port}`));
```

#### `manifest.yml` — CF Deployment Descriptor

```yaml
applications:
  - name: sap-help-mcp
    memory: 256M
    disk_quota: 512M
    buildpacks:
      - nodejs_buildpack
    command: node dist/server.js
    health-check-type: http
    health-check-http-endpoint: /
```

#### `.cfignore` — CF Push Exclusions

```
src/
*.ts
*.map
.git/
.gitignore
tsconfig.json
docs/
```

### Modified Files

#### `src/index.ts` — Stdio Entrypoint (Simplified)

Refactored to import `createMcpServer()` from `src/mcp-server.ts`. Reduced to just transport wiring:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("sap-help-mcp server started (stdio)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

#### `package.json` — New Scripts and Dependency

Add `express` dependency and new scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "start:http": "node dist/server.js",
    "dev": "tsc && node dist/index.js"
  },
  "dependencies": {
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21"
  }
}
```

## Deployment Flow

```
npm install          # install deps including express
npm run build        # compile TS to dist/
cf push              # deploy to CF using manifest.yml
```

The CF app starts via `node dist/server.js`, binds to `$PORT`, and responds to MCP requests over HTTP.

## Client Configuration

To connect to the CF-deployed server from Claude Code, use the MCP streamable HTTP URL:

```json
{
  "mcpServers": {
    "sap-help": {
      "type": "url",
      "url": "https://<cf-app-url>/mcp"
    }
  }
}
```

## What Stays the Same

- `src/api-client.ts` — unchanged
- `src/types.ts` — unchanged
- All tool definitions and handler logic — moved to `mcp-server.ts` but functionally identical
- Stdio entrypoint behavior — same as before, just imports from shared module
