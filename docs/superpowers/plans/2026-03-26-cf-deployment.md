# CF Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sap-help-mcp deployable on SAP BTP Cloud Foundry by adding an HTTP transport entrypoint alongside the existing stdio entrypoint.

**Architecture:** Extract shared MCP server logic into a factory module (`mcp-server.ts`). Keep the existing stdio entrypoint (`index.ts`) and add a new HTTP entrypoint (`server.ts`) using Express + `StreamableHTTPServerTransport` in stateless mode. Add CF deployment files (`manifest.yml`, `.cfignore`).

**Tech Stack:** TypeScript, MCP SDK v1.28.0 (`StreamableHTTPServerTransport`, `createMcpExpressApp`), Express (via SDK helper), CF Node.js buildpack

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/mcp-server.ts` | Create | Factory function that builds a configured MCP `Server` with all tools registered |
| `src/index.ts` | Modify | Stdio entrypoint — simplified to import factory + wire stdio transport |
| `src/server.ts` | Create | HTTP entrypoint — Express app with `/mcp` routes for CF deployment |
| `src/api-client.ts` | Unchanged | SAP Help Portal HTTP client |
| `src/types.ts` | Unchanged | TypeScript interfaces |
| `manifest.yml` | Create | CF deployment descriptor |
| `.cfignore` | Create | Exclude dev files from CF push |
| `package.json` | Modify | Add `start:http` script, add `express` + `@types/express` deps |

---

### Task 1: Install Express dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install express and types**

```bash
cd ~/sap-help-mcp && npm install express && npm install --save-dev @types/express
```

Expected: `package.json` now lists `express` under `dependencies` and `@types/express` under `devDependencies`.

- [ ] **Step 2: Add `start:http` script to package.json**

In `package.json`, add the `start:http` script to the `scripts` block. The final scripts should be:

```json
"scripts": {
  "build": "tsc",
  "watch": "tsc --watch",
  "start": "node dist/index.js",
  "start:http": "node dist/server.js",
  "dev": "tsc && node dist/index.js"
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/sap-help-mcp
git add package.json package-lock.json
git commit -m "chore: add express dependency for HTTP transport"
```

---

### Task 2: Extract MCP server factory into `mcp-server.ts`

**Files:**
- Create: `src/mcp-server.ts`

This extracts all MCP tool definitions, Zod schemas, handler logic, and formatting functions from `src/index.ts` into a reusable factory. The factory returns a fully configured `Server` instance.

- [ ] **Step 1: Create `src/mcp-server.ts`**

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SapHelpClient } from "./api-client.js";
import type { SearchResult, ProductResult } from "./types.js";

const SearchSchema = z.object({
  query: z.string().describe("Search query keywords"),
  product: z.string().optional().describe("Filter by SAP product ID (e.g. AI_CORE, SAPUI5)"),
  version: z.string().optional().describe("Filter by version (e.g. CLOUD, 2023)"),
  language: z.string().optional().default("en-US").describe("Language code (default: en-US)"),
  max_results: z.number().optional().default(10).describe("Max results to return (default: 10, max: 50)"),
});

const SemanticSearchSchema = z.object({
  query: z.string().describe("Natural language search query"),
  product: z.string().optional().describe("Filter by SAP product ID (e.g. AI_CORE, SAPUI5)"),
  version: z.string().optional().describe("Filter by version"),
  language: z.string().optional().default("en-US").describe("Language code (default: en-US)"),
  max_results: z.number().optional().default(10).describe("Max results to return (default: 10, max: 50)"),
});

const GetPageSchema = z.object({
  url: z.string().describe("URL or path of the SAP Help page to fetch (e.g. /docs/sap-ai-core/sap-ai-core-service-guide/what-is-sap-ai-core)"),
});

function formatSearchResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No results found for "${query}"`;
  }

  const lines = [`Found ${results.length} results for "${query}"\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const title = r.title || "Untitled";
    const url = r.url ? `https://help.sap.com${r.url}` : r.productPageUrl || "No URL";
    const snippet = (r.snippet || "").replace(/<\/?b>/g, "").replace(/&bull;/g, "-").trim();
    const product = r.product || r.productId || "";
    const version = r.version || r.versionId || "";
    const score = r.score ? ` (score: ${r.score})` : "";

    lines.push(`${i + 1}. ${title}${score}`);
    lines.push(`   URL: ${url}`);
    if (product) lines.push(`   Product: ${product}${version ? ` | Version: ${version}` : ""}`);
    if (snippet) lines.push(`   ${snippet.substring(0, 300)}`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatProducts(products: ProductResult[]): string {
  if (products.length === 0) {
    return "No products found";
  }

  const lines = [`Found ${products.length} SAP products\n`];

  for (const p of products) {
    const title = p.title || "Unknown";
    const id = p.product || "";
    const url = p.url ? `https://help.sap.com${p.url}` : "";
    lines.push(`- ${title} [${id}]${url ? ` — ${url}` : ""}`);
  }

  return lines.join("\n");
}

export function createMcpServer(): Server {
  const client = new SapHelpClient();

  const server = new Server(
    { name: "sap-help-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "sap_help_search",
        description:
          "Search SAP Help Portal (help.sap.com) documentation using keywords. " +
          "Returns topic titles, URLs, snippets, and product info. " +
          "Use this for specific keyword searches across all SAP documentation.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "Search query keywords" },
            product: { type: "string", description: "Filter by SAP product ID (e.g. AI_CORE, SAPUI5)" },
            version: { type: "string", description: "Filter by version (e.g. CLOUD, 2023)" },
            language: { type: "string", description: "Language code (default: en-US)", default: "en-US" },
            max_results: { type: "number", description: "Max results (default: 10, max: 50)", default: 10 },
          },
          required: ["query"],
        },
      },
      {
        name: "sap_help_semantic_search",
        description:
          "AI-powered semantic search on SAP Help Portal. " +
          "Better for natural language questions like 'how to deploy a model in AI Core'. " +
          "Returns ranked results with relevance scores.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "Natural language search query" },
            product: { type: "string", description: "Filter by SAP product ID" },
            version: { type: "string", description: "Filter by version" },
            language: { type: "string", description: "Language code (default: en-US)", default: "en-US" },
            max_results: { type: "number", description: "Max results (default: 10, max: 50)", default: 10 },
          },
          required: ["query"],
        },
      },
      {
        name: "sap_help_list_products",
        description:
          "List all available SAP products on the Help Portal. " +
          "Returns product names and IDs that can be used to filter searches.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "sap_help_get_page",
        description:
          "Fetch the full content of a specific SAP Help page. " +
          "Use URLs from search results. Returns cleaned text content.",
        inputSchema: {
          type: "object" as const,
          properties: {
            url: {
              type: "string",
              description: "URL or path of the SAP Help page (e.g. /docs/sap-ai-core/...)",
            },
          },
          required: ["url"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "sap_help_search": {
          const parsed = SearchSchema.parse(args);
          const maxResults = Math.min(Math.max(1, parsed.max_results || 10), 50);
          const results = await client.search(parsed.query, {
            product: parsed.product,
            version: parsed.version,
            language: parsed.language,
            maxResults,
          });
          return {
            content: [{ type: "text", text: formatSearchResults(results, parsed.query) }],
          };
        }

        case "sap_help_semantic_search": {
          const parsed = SemanticSearchSchema.parse(args);
          const maxResults = Math.min(Math.max(1, parsed.max_results || 10), 50);
          const results = await client.semanticSearch(parsed.query, {
            product: parsed.product,
            version: parsed.version,
            language: parsed.language,
            maxResults,
          });
          return {
            content: [{ type: "text", text: formatSearchResults(results, parsed.query) }],
          };
        }

        case "sap_help_list_products": {
          const products = await client.listProducts();
          return {
            content: [{ type: "text", text: formatProducts(products) }],
          };
        }

        case "sap_help_get_page": {
          const parsed = GetPageSchema.parse(args);
          const content = await client.fetchPage(parsed.url);
          if (!content || content.length < 50) {
            return {
              content: [{ type: "text", text: "Page returned empty or minimal content. The URL may be incorrect or the page may require authentication." }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: content }],
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Tool ${name} error:`, message);

      if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
        return {
          content: [{ type: "text", text: "NETWORK_ERROR: Cannot connect to help.sap.com" }],
          isError: true,
        };
      }

      if (message.includes("timeout")) {
        return {
          content: [{ type: "text", text: "TIMEOUT: Request to help.sap.com timed out" }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `ERROR: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ~/sap-help-mcp && npx tsc --noEmit
```

Expected: No errors. The file compiles cleanly.

- [ ] **Step 3: Commit**

```bash
cd ~/sap-help-mcp
git add src/mcp-server.ts
git commit -m "refactor: extract MCP server factory into mcp-server.ts"
```

---

### Task 3: Simplify stdio entrypoint to use factory

**Files:**
- Modify: `src/index.ts`

Replace the entire contents of `src/index.ts` with the simplified version that imports from the factory.

- [ ] **Step 1: Rewrite `src/index.ts`**

Replace the entire file with:

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

- [ ] **Step 2: Build and verify stdio still works**

```bash
cd ~/sap-help-mcp && npm run build
```

Expected: Build succeeds with no errors. `dist/index.js`, `dist/mcp-server.js`, and `dist/server.js` (once created) all appear.

Then do a quick smoke test — the server should start on stdio and print its startup message:

```bash
cd ~/sap-help-mcp && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | timeout 5 node dist/index.js 2>&1 || true
```

Expected: stderr shows `sap-help-mcp server started (stdio)` and stdout returns a JSON-RPC response with server info.

- [ ] **Step 3: Commit**

```bash
cd ~/sap-help-mcp
git add src/index.ts
git commit -m "refactor: simplify stdio entrypoint to use shared factory"
```

---

### Task 4: Create HTTP entrypoint (`server.ts`)

**Files:**
- Create: `src/server.ts`

Uses the MCP SDK's `createMcpExpressApp()` helper (provides Express with JSON body parsing pre-configured) and `StreamableHTTPServerTransport` in stateless mode. In stateless mode, each POST request creates a fresh server + transport instance. GET and DELETE on `/mcp` return 405 since there are no persistent sessions.

- [ ] **Step 1: Create `src/server.ts`**

```ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createMcpServer } from "./mcp-server.js";

const app = createMcpExpressApp({ host: "0.0.0.0" });

app.get("/", (_req, res) => {
  res.json({ status: "ok", name: "sap-help-mcp" });
});

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (_req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  }));
});

app.delete("/mcp", async (_req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  }));
});

const port = parseInt(process.env.PORT || "8080", 10);
app.listen(port, () => {
  console.log(`sap-help-mcp HTTP server on port ${port}`);
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  process.exit(0);
});
```

- [ ] **Step 2: Build**

```bash
cd ~/sap-help-mcp && npm run build
```

Expected: Build succeeds. `dist/server.js` is created alongside `dist/index.js` and `dist/mcp-server.js`.

- [ ] **Step 3: Smoke test the HTTP server**

Start the server in the background and hit the health endpoint:

```bash
cd ~/sap-help-mcp && node dist/server.js &
SERVER_PID=$!
sleep 2
curl -s http://localhost:8080/
kill $SERVER_PID
```

Expected: `{"status":"ok","name":"sap-help-mcp"}`

- [ ] **Step 4: Test MCP initialize via HTTP**

Start the server again and send an MCP initialize request:

```bash
cd ~/sap-help-mcp && node dist/server.js &
SERVER_PID=$!
sleep 2
curl -s -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
kill $SERVER_PID
```

Expected: A JSON-RPC response (either as JSON or SSE events) containing `serverInfo` with name `sap-help-mcp`.

- [ ] **Step 5: Commit**

```bash
cd ~/sap-help-mcp
git add src/server.ts
git commit -m "feat: add HTTP entrypoint for Cloud Foundry deployment"
```

---

### Task 5: Add CF deployment files

**Files:**
- Create: `manifest.yml`
- Create: `.cfignore`

- [ ] **Step 1: Create `manifest.yml`**

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

- [ ] **Step 2: Create `.cfignore`**

```
src/
*.ts
*.map
.git/
.gitignore
tsconfig.json
docs/
```

- [ ] **Step 3: Commit**

```bash
cd ~/sap-help-mcp
git add manifest.yml .cfignore
git commit -m "feat: add CF manifest and cfignore for BTP deployment"
```

---

### Task 6: Update README with deployment instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add deployment section to README.md**

After the existing "Usage with Claude Code" section, add:

```markdown
## Deploy to SAP BTP Cloud Foundry

```bash
npm run build
cf push
```

The app deploys using `manifest.yml` and starts the HTTP transport on the CF-assigned port.

### Connect to deployed server

```json
{
  "mcpServers": {
    "sap-help": {
      "type": "url",
      "url": "https://<your-cf-app-url>/mcp"
    }
  }
}
```

### Run HTTP server locally

```bash
npm run build
npm run start:http    # starts on port 8080
```
```

- [ ] **Step 2: Commit**

```bash
cd ~/sap-help-mcp
git add README.md
git commit -m "docs: add CF deployment and HTTP server instructions to README"
```

---

### Task 7: Final build verification and push

- [ ] **Step 1: Clean build from scratch**

```bash
cd ~/sap-help-mcp && rm -rf dist && npm run build
```

Expected: Build succeeds. `dist/` contains `index.js`, `mcp-server.js`, `server.js` (plus `.d.ts` and `.map` files).

- [ ] **Step 2: Verify stdio entrypoint still works**

```bash
cd ~/sap-help-mcp && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | timeout 5 node dist/index.js 2>&1 || true
```

Expected: stderr shows startup message, stdout shows JSON-RPC initialize response.

- [ ] **Step 3: Verify HTTP entrypoint works**

```bash
cd ~/sap-help-mcp && node dist/server.js &
SERVER_PID=$!
sleep 2
echo "--- Health check ---"
curl -s http://localhost:8080/
echo ""
echo "--- MCP initialize ---"
curl -s -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
echo ""
kill $SERVER_PID
```

Expected: Health check returns `{"status":"ok","name":"sap-help-mcp"}`. MCP initialize returns server info.

- [ ] **Step 4: Push to GitHub**

```bash
cd ~/sap-help-mcp && git push origin main
```
