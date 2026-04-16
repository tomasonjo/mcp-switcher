import type { McpServerStdio, McpServerUrl } from "./types";

export type McpTemplate = {
  id: string;
  label: string;
  description: string;
  category: "neo4j" | "agents" | "filesystem" | "web" | "dev" | "example";
  build: () => ImportedServer;
  requiredEnv?: { key: string; hint: string }[];
};

export const TEMPLATES: McpTemplate[] = [
  {
    id: "neo4j-cypher",
    label: "Neo4j Cypher",
    description:
      "Official Neo4j MCP server — read/write Cypher, schema introspection.",
    category: "neo4j",
    requiredEnv: [
      { key: "NEO4J_URI", hint: "bolt://localhost:7687" },
      { key: "NEO4J_USERNAME", hint: "neo4j" },
      { key: "NEO4J_PASSWORD", hint: "…" },
    ],
    build: () => ({
      transport: "stdio",
      name: "neo4j-cypher",
      command: "uvx",
      args: ["mcp-neo4j-cypher@latest", "--transport", "stdio"],
      env: {
        NEO4J_URI: "bolt://localhost:7687",
        NEO4J_USERNAME: "neo4j",
        NEO4J_PASSWORD: "",
      },
    }),
  },
  {
    id: "neo4j-memory",
    label: "Neo4j Memory",
    description:
      "Graph-backed long-term memory: persists and recalls entities/relations in Neo4j.",
    category: "neo4j",
    requiredEnv: [
      { key: "NEO4J_URI", hint: "bolt://localhost:7687" },
      { key: "NEO4J_USERNAME", hint: "neo4j" },
      { key: "NEO4J_PASSWORD", hint: "…" },
    ],
    build: () => ({
      transport: "stdio",
      name: "neo4j-memory",
      command: "uvx",
      args: ["mcp-neo4j-memory@latest", "--transport", "stdio"],
      env: {
        NEO4J_URI: "bolt://localhost:7687",
        NEO4J_USERNAME: "neo4j",
        NEO4J_PASSWORD: "",
      },
    }),
  },
  {
    id: "claude-managed-agents",
    label: "Claude Managed Agents",
    description:
      "Expose Anthropic's Managed Agents API as MCP tools — spawn and talk to cloud-hosted Claude agents.",
    category: "agents",
    requiredEnv: [{ key: "ANTHROPIC_API_KEY", hint: "sk-ant-…" }],
    build: () => ({
      transport: "stdio",
      name: "claude-managed-agents",
      command: "uvx",
      args: [
        "--from",
        "git+https://github.com/tomasonjo/claude-managed-agents-neo4j.git",
        "claude-managed-agents-mcp",
      ],
      env: { ANTHROPIC_API_KEY: "" },
    }),
  },
  {
    id: "aura-agents",
    label: "Aura Agents (management)",
    description:
      "Manage Neo4j Aura Agents via the Aura API. Uses a local Neo4j instance for agent memory.",
    category: "agents",
    requiredEnv: [
      { key: "AURA_CLIENT_ID", hint: "Aura API client id" },
      { key: "AURA_CLIENT_SECRET", hint: "Aura API client secret" },
      { key: "NEO4J_MEMORY_URI", hint: "bolt://localhost:7687" },
      { key: "NEO4J_MEMORY_USERNAME", hint: "neo4j" },
      { key: "NEO4J_MEMORY_PASSWORD", hint: "…" },
    ],
    build: () => ({
      transport: "stdio",
      name: "aura_agents",
      command: "uvx",
      args: [
        "--from",
        "git+https://github.com/tomasonjo/aura-agents-management-mcp",
        "aura-agents-management-mcp",
      ],
      env: {
        AURA_CLIENT_ID: "",
        AURA_CLIENT_SECRET: "",
        NEO4J_MEMORY_URI: "bolt://localhost:7687",
        NEO4J_MEMORY_USERNAME: "neo4j",
        NEO4J_MEMORY_PASSWORD: "password",
      },
    }),
  },
  {
    id: "filesystem",
    label: "Filesystem",
    description:
      "Sandboxed read/write/list over a local directory. Replace /path/to/dir with an allowed directory.",
    category: "filesystem",
    build: () => ({
      transport: "stdio",
      name: "filesystem",
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/dir",
      ],
    }),
  },
  {
    id: "fetch",
    label: "Fetch",
    description:
      "Fetch URL contents (HTML → markdown). Good for letting Claude read pages.",
    category: "web",
    build: () => ({
      transport: "stdio",
      name: "fetch",
      command: "uvx",
      args: ["mcp-server-fetch"],
    }),
  },
  {
    id: "git",
    label: "Git",
    description: "Read-only git operations (log, diff, blame) on a repo.",
    category: "dev",
    build: () => ({
      transport: "stdio",
      name: "git",
      command: "uvx",
      args: ["mcp-server-git", "--repository", "/path/to/repo"],
    }),
  },
  {
    id: "everything",
    label: "Everything (demo)",
    description:
      "Reference server showcasing tools/prompts/resources — useful for smoke-testing.",
    category: "example",
    build: () => ({
      transport: "stdio",
      name: "everything",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    }),
  },
];

export type ImportedServer =
  | Omit<McpServerUrl, "id" | "enabled">
  | Omit<McpServerStdio, "id" | "enabled">;

/**
 * Serialise an array of servers into the Claude-Desktop-style config shape:
 *   { "mcpServers": { "<name>": { command/args/env | url/authorization_token } } }
 * Callers should pre-filter to the servers they want included (e.g. enabled only).
 */
export function stringifyMcpConfig(
  servers: Array<McpServerUrl | McpServerStdio>,
): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  const taken = new Set<string>();

  for (const s of servers) {
    let name = s.name || "server";
    let k = 2;
    while (taken.has(name)) name = `${s.name}-${k++}`;
    taken.add(name);

    if (s.transport === "url") {
      const entry: Record<string, unknown> = { url: s.url };
      if (s.authorizationToken) entry.authorization_token = s.authorizationToken;
      mcpServers[name] = entry;
    } else {
      const entry: Record<string, unknown> = { command: s.command };
      if (s.args && s.args.length > 0) entry.args = s.args;
      if (s.env && Object.keys(s.env).length > 0) entry.env = s.env;
      mcpServers[name] = entry;
    }
  }

  return JSON.stringify({ mcpServers }, null, 2);
}

type RawEntry = {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  type?: unknown;
  authorization_token?: unknown;
  authorizationToken?: unknown;
};

/**
 * Parse a Claude-Desktop-style config:
 *   { "mcpServers": { "<name>": { "command": ..., "args": [...], "env": {...} } } }
 * Also accepts the URL shape:
 *   { "mcpServers": { "<name>": { "url": "https://...", "authorization_token": "..." } } }
 * Or a single server object at the root, or a bare array.
 */
export function parseMcpConfig(text: string): ImportedServer[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new Error(
      "Invalid JSON: " + (e instanceof Error ? e.message : String(e)),
    );
  }

  const out: ImportedServer[] = [];

  const processEntry = (name: string, entry: RawEntry) => {
    if (!entry || typeof entry !== "object") return;

    // URL transport
    if (typeof entry.url === "string" && entry.url.length > 0) {
      const urlEntry: Omit<McpServerUrl, "id" | "enabled"> = {
        transport: "url",
        name,
        url: entry.url,
        authorizationToken:
          typeof entry.authorization_token === "string"
            ? entry.authorization_token
            : typeof entry.authorizationToken === "string"
              ? entry.authorizationToken
              : undefined,
      };
      out.push(urlEntry);
      return;
    }

    // stdio transport
    if (typeof entry.command === "string" && entry.command.length > 0) {
      const args = Array.isArray(entry.args)
        ? (entry.args as unknown[]).map(String)
        : [];
      const env =
        entry.env && typeof entry.env === "object" && !Array.isArray(entry.env)
          ? Object.fromEntries(
              Object.entries(entry.env as Record<string, unknown>).map(
                ([k, v]) => [k, String(v)],
              ),
            )
          : undefined;
      const stdioEntry: Omit<McpServerStdio, "id" | "enabled"> = {
        transport: "stdio",
        name,
        command: entry.command,
        args,
        env,
      };
      out.push(stdioEntry);
    }
  };

  const record = parsed as Record<string, unknown>;

  // Claude Desktop-style: { mcpServers: { name: {...} } }
  if (record && typeof record === "object" && "mcpServers" in record) {
    const servers = record.mcpServers as Record<string, RawEntry>;
    for (const [name, entry] of Object.entries(servers || {})) {
      processEntry(name, entry);
    }
    return out;
  }

  // Array of entries: [{ name, command, ... }, ...]
  if (Array.isArray(parsed)) {
    for (const item of parsed as RawEntry[]) {
      const name =
        typeof (item as { name?: unknown }).name === "string"
          ? String((item as { name: string }).name)
          : `server-${out.length + 1}`;
      processEntry(name, item);
    }
    return out;
  }

  // Single-entry record { name, command, ... } or { name, url, ... }
  if (record && typeof record === "object") {
    const name =
      typeof record.name === "string" ? String(record.name) : "server";
    processEntry(name, record as RawEntry);
  }

  return out;
}
