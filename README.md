# sap-help-mcp

An MCP (Model Context Protocol) server for searching [SAP Help Portal](https://help.sap.com) documentation. Enables AI assistants to search, browse, and retrieve SAP documentation programmatically.

## Tools

| Tool | Description |
|------|-------------|
| `sap_help_search` | Keyword search across all SAP Help Portal documentation |
| `sap_help_semantic_search` | AI-powered semantic search for natural language questions |
| `sap_help_list_products` | List all available SAP products with IDs for filtering |
| `sap_help_get_page` | Fetch and extract clean text content from a specific help page |

## Setup

```bash
npm install
npm run build
```

## Usage with Claude Code

Add to your Claude Code MCP config (`.claude.json`):

```json
{
  "mcpServers": {
    "sap-help": {
      "command": "node",
      "args": ["/path/to/sap-help-mcp/dist/index.js"]
    }
  }
}
```

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

## Examples

**Keyword search:**
> Search for "SD pricing configuration" filtered by S/4HANA

**Semantic search:**
> "How do I configure batch jobs in SAP AI Core?"

**Browse products:**
> List all SAP products to find the right product ID filter

**Fetch a page:**
> Get the full content of a specific help page URL from search results

## Tech Stack

- TypeScript
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Axios for HTTP
- Zod for input validation

## License

MIT
