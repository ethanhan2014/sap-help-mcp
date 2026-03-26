import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SapHelpClient } from "./api-client.js";
import type { SearchResult, ProductResult } from "./types.js";

const client = new SapHelpClient();

const server = new Server(
  { name: "sap-help-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// --- Zod Schemas ---

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

// --- Tool Registration ---

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

// --- Tool Handlers ---

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

// --- Start Server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("sap-help-mcp server started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
