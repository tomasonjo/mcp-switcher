import type { McpServer } from "./types";

const KEY = "mcp-switcher.servers.v2";
const LEGACY_KEY = "mcp-switcher.servers.v1";

type UnknownServer = Partial<McpServer> & Record<string, unknown>;

function normalise(raw: UnknownServer): McpServer | null {
  if (!raw || typeof raw !== "object") return null;
  const base = {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    enabled: Boolean(raw.enabled),
  };
  if (!base.id || !base.name) return null;

  const transport = raw.transport ?? (raw.url ? "url" : null);
  if (transport === "url") {
    const url = typeof raw.url === "string" ? raw.url : "";
    if (!url) return null;
    return {
      ...base,
      transport: "url",
      url,
      authorizationToken:
        typeof raw.authorizationToken === "string" && raw.authorizationToken
          ? raw.authorizationToken
          : undefined,
    };
  }
  if (transport === "stdio") {
    const command = typeof raw.command === "string" ? raw.command : "";
    if (!command) return null;
    const args = Array.isArray(raw.args)
      ? (raw.args as unknown[]).map(String)
      : [];
    const env =
      raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
        ? Object.fromEntries(
            Object.entries(raw.env as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v),
            ]),
          )
        : undefined;
    return {
      ...base,
      transport: "stdio",
      command,
      args,
      env,
    };
  }
  return null;
}

export function loadServers(): McpServer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.localStorage.getItem(KEY) ||
      window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UnknownServer[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalise).filter((s): s is McpServer => s !== null);
  } catch {
    return [];
  }
}

export function saveServers(servers: McpServer[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(servers));
}

export function randomId() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}
