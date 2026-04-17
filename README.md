# MCP Switcher

A clean, Claude-style chat UI that connects to the Anthropic Messages API with
**dynamically toggleable MCP servers**. Define any number of remote MCP servers,
then flip individual servers on/off per conversation turn from the sidebar.

Built on the current MCP connector beta (`mcp-client-2025-11-20`) with
`mcp_servers` + `mcp_toolset` — see the
[MCP connector docs](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector).

## Setup

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=...

npm install
npm run dev
# open http://localhost:3000
```

## Features

- **Server-side API key** — `ANTHROPIC_API_KEY` lives in `.env` and is never
  shipped to the browser.
- **Two transports, one toggle:**
  - **URL** (remote HTTPS) — routed through Anthropic's MCP connector via the
    `mcp_servers` + `mcp_toolset` parameters.
  - **stdio** — spawned as child processes on the Next.js host (`@modelcontextprotocol/sdk`
    `StdioClientTransport`), their tools exposed to Claude and executed locally
    in a tool-use loop.
- **Templates** — one-click presets for common servers (Neo4j Cypher, Neo4j
  memory, claude-managed-agents, filesystem, fetch, git, everything). See
  `lib/templates.ts` to extend.
- **Import JSON** — paste a `claude_desktop_config.json`-style config and all
  entries under `mcpServers` are added at once.
- **Per-turn filter** — every server has a toggle; only enabled servers are
  sent with the next request. Toggle mid-conversation to change tool
  availability.
- **Streaming** — SSE pipes text, `mcp_tool_use`/`mcp_tool_result`, and
  stdio `tool_use`/`tool_result` blocks into the UI as they arrive.
- **Model picker** — Anthropic (Opus 4.7, Sonnet 4.6, Haiku 4.5) and
  **Ollama** (any locally installed tool-capable model — llama3.1+, qwen2.5+,
  mistral-nemo, etc.). Ollama models are fetched live from
  `$OLLAMA_BASE_URL/api/tags` (default `http://localhost:11434`).

## Notes & caveats

- Stdio servers run as child processes on the host with your environment
  variables. Only add commands you trust.
- Templates with required env vars (e.g. Neo4j creds, `ANTHROPIC_API_KEY`) are
  added with placeholder values — click **Edit** on the card to fill them in.
- Tool-use loop is capped at 16 turns per request.
- **Ollama**: install and run `ollama serve`, pull a tool-capable model
  (`ollama pull qwen2.5`), then pick it from the sidebar. With Ollama,
  *all* enabled MCP servers — URL and stdio — are connected locally and
  their tools are forwarded via Ollama's OpenAI-compatible tool-calling
  API (no Anthropic managed connector involved). Override the endpoint
  with `OLLAMA_BASE_URL` if Ollama isn't on `localhost:11434`.
