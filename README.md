# ArielCharts

Real-time collaborative Mermaid diagram editor. Humans and AI agents edit the same diagram simultaneously — humans via a browser-based editor, agents via MCP tools.

## Architecture

pnpm monorepo:
- `apps/web` — Next.js frontend (TypeScript, CodeMirror 6, Yjs CRDT, mermaid v11)
- `apps/server` — Node.js + Express backend (TypeScript, WebSocket, MCP SDK, SQLite)
- `packages/shared` — Shared types

## Development

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:3000
- Server: http://localhost:3001

## MCP Server

Agents can connect via the MCP server at `/mcp` (Streamable HTTP transport):

```json
{
  "mcpServers": {
    "arielcharts": {
      "type": "streamable-http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### Tools
- `read_diagram` — Read the current diagram for a session
- `write_diagram` — Replace the diagram for a session  
- `list_sessions` — List all available sessions
