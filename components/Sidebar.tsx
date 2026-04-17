"use client";

import { useEffect, useState } from "react";
import type { McpServer } from "@/lib/types";
import { randomId } from "@/lib/storage";
import {
  TEMPLATES,
  parseMcpConfig,
  stringifyMcpConfig,
  type ImportedServer,
} from "@/lib/templates";

type Props = {
  servers: McpServer[];
  onChange: (servers: McpServer[]) => void;
  model: string;
  onModelChange: (m: string) => void;
};

const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

type OllamaModelsResponse = {
  models: string[];
  baseUrl?: string;
  error?: string;
};

export function Sidebar({ servers, onChange, model, onModelChange }: Props) {
  // Pending server being edited/created in the form. When non-null, the
  // ServerForm is open pre-filled with its values.
  const [pending, setPending] = useState<McpServer | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [ollama, setOllama] = useState<OllamaModelsResponse>({ models: [] });

  useEffect(() => {
    let alive = true;
    fetch("/api/ollama/models", { cache: "no-store" })
      .then((r) => r.json() as Promise<OllamaModelsResponse>)
      .then((d) => {
        if (alive) setOllama(d);
      })
      .catch((e) => {
        if (alive) setOllama({ models: [], error: String(e) });
      });
    return () => {
      alive = false;
    };
  }, []);

  const existingNames = new Set(servers.map((s) => s.name));

  function uniqueName(base: string) {
    let name = base;
    let k = 2;
    while (existingNames.has(name)) name = `${base}-${k++}`;
    return name;
  }

  function addMany(entries: ImportedServer[]) {
    if (entries.length === 0) return;
    const taken = new Set(servers.map((s) => s.name));
    const newServers: McpServer[] = [];
    for (const e of entries) {
      let name = e.name;
      let k = 2;
      while (taken.has(name)) name = `${e.name}-${k++}`;
      taken.add(name);
      newServers.push({
        ...e,
        name,
        id: randomId(),
        enabled: true,
      } as McpServer);
    }
    onChange([...servers, ...newServers]);
  }

  const toggle = (id: string) => {
    onChange(
      servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  const remove = (id: string) => {
    onChange(servers.filter((s) => s.id !== id));
  };

  const upsert = (server: McpServer) => {
    const exists = servers.some((s) => s.id === server.id);
    onChange(
      exists
        ? servers.map((s) => (s.id === server.id ? server : s))
        : [...servers, server],
    );
    setPending(null);
  };

  function openBlank() {
    setPending({
      id: randomId(),
      transport: "url",
      name: "",
      url: "",
      authorizationToken: "",
      enabled: true,
    });
    setShowTemplates(false);
    setShowImport(false);
  }

  function openFromTemplate(entry: ImportedServer) {
    const name = uniqueName(entry.name);
    const id = randomId();
    const prefilled: McpServer =
      entry.transport === "url"
        ? {
            id,
            enabled: true,
            transport: "url",
            name,
            url: entry.url,
            authorizationToken: entry.authorizationToken,
          }
        : {
            id,
            enabled: true,
            transport: "stdio",
            name,
            command: entry.command,
            args: entry.args,
            env: entry.env,
          };
    setPending(prefilled);
    setShowTemplates(false);
    setShowImport(false);
  }

  const enabledCount = servers.filter((s) => s.enabled).length;

  return (
    <aside className="w-[340px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col h-full">
      <div className="px-4 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[var(--color-accent)] flex items-center justify-center text-[11px] font-bold text-black">
            C
          </div>
          <div className="font-semibold tracking-tight">MCP Switcher</div>
        </div>
        <div className="mt-1 text-xs text-[var(--color-muted)]">
          Claude chat with toggleable MCP servers
        </div>
      </div>

      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <label className="block text-[11px] uppercase tracking-wider text-[var(--color-muted)] mb-1.5">
          Model
        </label>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full bg-[var(--color-panel-2)] border border-[var(--color-border)] rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
        >
          <optgroup label="Anthropic">
            {ANTHROPIC_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
          {ollama.models.length > 0 && (
            <optgroup label="Ollama (local)">
              {ollama.models.map((name) => (
                <option key={`ollama:${name}`} value={`ollama:${name}`}>
                  {name}
                </option>
              ))}
            </optgroup>
          )}
          {(() => {
            const known = new Set<string>([
              ...ANTHROPIC_MODELS.map((m) => m.id),
              ...ollama.models.map((n) => `ollama:${n}`),
            ]);
            if (known.has(model)) return null;
            return (
              <option value={model}>
                {model.startsWith("ollama:")
                  ? `${model.slice(7)} (offline)`
                  : model}
              </option>
            );
          })()}
        </select>
        <div className="mt-1.5 text-[10.5px] text-[var(--color-muted)] leading-snug">
          {ollama.models.length > 0 ? (
            <>
              Ollama: {ollama.models.length} model
              {ollama.models.length === 1 ? "" : "s"} at{" "}
              <code>{ollama.baseUrl || "localhost:11434"}</code>
            </>
          ) : ollama.error ? (
            <span className="text-amber-300/90">
              Ollama unavailable — start <code>ollama serve</code> and reload
              for local models.
            </span>
          ) : (
            <span className="opacity-70">Checking Ollama…</span>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              MCP Servers
            </div>
            <div className="text-xs text-[var(--color-muted)] mt-0.5">
              {enabledCount} of {servers.length} active
            </div>
          </div>
          <button
            onClick={openBlank}
            className="text-xs px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-black font-medium hover:opacity-90"
          >
            + Add
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => {
              setShowTemplates((s) => !s);
              setShowImport(false);
              setShowExport(false);
              setPending(null);
            }}
            className={`flex-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
              showTemplates
                ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            Templates
          </button>
          <button
            onClick={() => {
              setShowImport((s) => !s);
              setShowTemplates(false);
              setShowExport(false);
              setPending(null);
            }}
            className={`flex-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
              showImport
                ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            Import
          </button>
          <button
            onClick={() => {
              setShowExport((s) => !s);
              setShowTemplates(false);
              setShowImport(false);
              setPending(null);
            }}
            disabled={enabledCount === 0}
            className={`flex-1 text-[11px] px-2 py-1 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              showExport
                ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
            title={
              enabledCount === 0
                ? "Enable at least one server to export"
                : "Export enabled servers as JSON"
            }
          >
            Export
          </button>
        </div>
      </div>

      {showTemplates && (
        <TemplatePicker
          onPick={openFromTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {showImport && (
        <ImportPanel
          onImport={(entries) => {
            addMany(entries);
            setShowImport(false);
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {showExport && (
        <ExportPanel
          servers={servers.filter((s) => s.enabled)}
          onClose={() => setShowExport(false)}
        />
      )}

      {pending && !servers.some((s) => s.id === pending.id) && (
        <div className="mx-3 mb-3">
          <ServerForm
            initial={pending}
            onSave={upsert}
            onCancel={() => setPending(null)}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
        {servers.length === 0 && !pending && !showTemplates && !showImport && (
          <div className="text-xs text-[var(--color-muted)] px-2 py-6 text-center">
            No MCP servers yet. Click{" "}
            <span className="text-[var(--color-text)]">+ Add</span> or{" "}
            <span className="text-[var(--color-text)]">Templates</span> to get
            started.
          </div>
        )}

        {servers.map((s) => (
          <ServerCard
            key={s.id}
            server={s}
            editing={pending?.id === s.id}
            onToggle={() => toggle(s.id)}
            onEdit={() => setPending(s)}
            onRemove={() => remove(s.id)}
            onSave={upsert}
            onCancel={() => setPending(null)}
          />
        ))}
      </div>

      <div className="px-4 py-3 border-t border-[var(--color-border)] text-[11px] text-[var(--color-muted)] leading-relaxed">
        URL servers go through Anthropic&apos;s MCP connector. Stdio servers run
        as child processes on this host.
      </div>
    </aside>
  );
}

function ServerCard({
  server,
  editing,
  onToggle,
  onEdit,
  onRemove,
  onSave,
  onCancel,
}: {
  server: McpServer;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onSave: (s: McpServer) => void;
  onCancel: () => void;
}) {
  if (editing) {
    return <ServerForm initial={server} onSave={onSave} onCancel={onCancel} />;
  }

  const subtitle =
    server.transport === "url"
      ? server.url
      : [server.command, ...(server.args ?? [])].join(" ").trim();

  return (
    <div
      className={`group rounded-lg border px-3 py-2.5 transition-colors ${
        server.enabled
          ? "border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)]"
          : "border-[var(--color-border)] bg-[var(--color-panel-2)]"
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={onToggle}
          aria-label={server.enabled ? "Disable server" : "Enable server"}
          className={`mt-0.5 w-9 h-5 rounded-full relative shrink-0 transition-colors ${
            server.enabled
              ? "bg-[var(--color-accent)]"
              : "bg-[var(--color-border)]"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
              server.enabled ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{server.name}</span>
            <TransportBadge transport={server.transport} />
          </div>
          <div
            className="text-[11px] text-[var(--color-muted)] truncate font-mono"
            title={subtitle}
          >
            {subtitle}
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="text-[11px] px-2 py-0.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-panel-2)]"
        >
          Edit
        </button>
        <button
          onClick={onRemove}
          className="text-[11px] px-2 py-0.5 rounded border border-[var(--color-border)] text-red-300 hover:bg-red-500/10"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function TransportBadge({ transport }: { transport: "url" | "stdio" }) {
  const isUrl = transport === "url";
  return (
    <span
      className={`text-[9.5px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${
        isUrl
          ? "border-sky-500/40 text-sky-300 bg-sky-500/10"
          : "border-amber-500/40 text-amber-300 bg-amber-500/10"
      }`}
    >
      {transport}
    </span>
  );
}

function ServerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: McpServer;
  onSave: (s: McpServer) => void;
  onCancel: () => void;
}) {
  const [transport, setTransport] = useState<"url" | "stdio">(initial.transport);
  const [name, setName] = useState(initial.name);

  // url fields
  const [url, setUrl] = useState(
    initial.transport === "url" ? initial.url : "",
  );
  const [token, setToken] = useState(
    initial.transport === "url" ? initial.authorizationToken || "" : "",
  );

  // stdio fields
  const [command, setCommand] = useState(
    initial.transport === "stdio" ? initial.command : "",
  );
  const [argsText, setArgsText] = useState(
    initial.transport === "stdio" ? (initial.args || []).join("\n") : "",
  );
  const [envText, setEnvText] = useState(
    initial.transport === "stdio"
      ? Object.entries(initial.env || {})
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : "",
  );

  const canSave =
    name.trim().length > 0 &&
    (transport === "url"
      ? /^https:\/\//i.test(url.trim())
      : command.trim().length > 0);

  function save() {
    if (transport === "url") {
      onSave({
        id: initial.id,
        transport: "url",
        name: name.trim(),
        url: url.trim(),
        authorizationToken: token.trim() || undefined,
        enabled: initial.enabled,
      });
    } else {
      const args = argsText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const env: Record<string, string> = {};
      for (const line of envText.split(/\r?\n/)) {
        const idx = line.indexOf("=");
        if (idx <= 0) continue;
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1);
        if (k) env[k] = v;
      }
      onSave({
        id: initial.id,
        transport: "stdio",
        name: name.trim(),
        command: command.trim(),
        args,
        env: Object.keys(env).length ? env : undefined,
        enabled: initial.enabled,
      });
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-accent)]/60 bg-[var(--color-panel-2)] p-3 space-y-2">
      <div className="flex gap-1 bg-[var(--color-bg)] p-0.5 rounded-md border border-[var(--color-border)]">
        <TransportTab
          active={transport === "url"}
          onClick={() => setTransport("url")}
          label="URL"
          hint="Remote MCP server"
        />
        <TransportTab
          active={transport === "stdio"}
          onClick={() => setTransport("stdio")}
          label="stdio"
          hint="Local process"
        />
      </div>

      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={transport === "url" ? "my-mcp" : "filesystem"}
          className="input"
        />
      </Field>

      {transport === "url" ? (
        <>
          <Field label="URL (https://)">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/sse"
              className="input"
            />
          </Field>
          <Field label="Authorization token (optional)">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder="Bearer token"
              className="input"
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="Command">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              className="input font-mono"
            />
          </Field>
          <Field label="Arguments (one per line)">
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
              rows={4}
              className="input font-mono resize-none"
            />
          </Field>
          <Field label="Environment (KEY=VALUE per line, optional)">
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder="API_KEY=..."
              rows={2}
              className="input font-mono resize-none"
            />
          </Field>
          <div className="text-[10.5px] text-amber-300/90 leading-snug">
            Runs as a child process on the Next.js host with your environment.
            Only use trusted commands.
          </div>
        </>
      )}

      <div className="flex gap-2 pt-1">
        <button
          disabled={!canSave}
          onClick={save}
          className="flex-1 text-xs px-2 py-1.5 rounded-md bg-[var(--color-accent)] text-black font-medium disabled:opacity-40"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-panel-2)]"
        >
          Cancel
        </button>
      </div>
      <style jsx>{`
        .input {
          width: 100%;
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          padding: 6px 8px;
          font-size: 12.5px;
          color: var(--color-text);
          outline: none;
        }
        .input:focus {
          border-color: var(--color-accent);
        }
      `}</style>
    </div>
  );
}

function TransportTab({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-xs py-1 rounded transition-colors ${
        active
          ? "bg-[var(--color-panel)] text-[var(--color-text)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
      }`}
      title={hint}
    >
      {label}
    </button>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  neo4j: "Neo4j",
  agents: "Agents",
  filesystem: "Filesystem",
  web: "Web",
  dev: "Developer",
  example: "Examples",
};
const CATEGORY_ORDER = ["neo4j", "agents", "filesystem", "web", "dev", "example"];

function TemplatePicker({
  onPick,
  onClose,
}: {
  onPick: (entry: ImportedServer) => void;
  onClose: () => void;
}) {
  const grouped = new Map<string, typeof TEMPLATES>();
  for (const t of TEMPLATES) {
    const list = grouped.get(t.category) ?? [];
    list.push(t);
    grouped.set(t.category, list);
  }
  const orderedCategories = CATEGORY_ORDER.filter((c) => grouped.has(c));

  return (
    <div className="mx-3 mb-3 rounded-lg border border-[var(--color-accent)]/60 bg-[var(--color-panel-2)] p-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
          Pick a template
        </div>
        <button
          onClick={onClose}
          className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          close
        </button>
      </div>
      <div className="space-y-3 max-h-[360px] overflow-y-auto pr-0.5">
        {orderedCategories.map((cat) => (
          <div key={cat}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1 px-0.5">
              {CATEGORY_LABELS[cat] ?? cat}
            </div>
            <div className="space-y-1">
              {grouped.get(cat)!.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onPick(t.build())}
                  className="w-full text-left rounded-md px-2 py-1.5 border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-colors"
                >
                  <div className="text-xs font-medium">{t.label}</div>
                  <div className="text-[11px] text-[var(--color-muted)] mt-0.5 leading-snug">
                    {t.description}
                  </div>
                  {t.requiredEnv && t.requiredEnv.length > 0 && (
                    <div className="text-[10px] text-amber-300/90 mt-1">
                      needs: {t.requiredEnv.map((e) => e.key).join(", ")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-[var(--color-muted)] mt-2 leading-snug">
        Clicking a template opens the add form pre-filled — fill in creds or
        paths, then Save.
      </div>
    </div>
  );
}

function ImportPanel({
  onImport,
  onClose,
}: {
  onImport: (entries: ImportedServer[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(
    `{
  "mcpServers": {
    "example": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}`,
  );
  const [err, setErr] = useState<string | null>(null);

  function doImport() {
    setErr(null);
    try {
      const entries = parseMcpConfig(text);
      if (entries.length === 0) {
        setErr("No servers found in that JSON.");
        return;
      }
      onImport(entries);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mx-3 mb-3 rounded-lg border border-[var(--color-accent)]/60 bg-[var(--color-panel-2)] p-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
          Paste MCP config (Claude-Desktop style)
        </div>
        <button
          onClick={onClose}
          className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          close
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        spellCheck={false}
        className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-2 text-[11.5px] font-mono leading-snug outline-none focus:border-[var(--color-accent)] resize-none"
      />
      {err && (
        <div className="text-[10.5px] text-red-300 mt-1.5">{err}</div>
      )}
      <div className="flex gap-2 mt-2">
        <button
          onClick={doImport}
          className="flex-1 text-xs px-2 py-1.5 rounded-md bg-[var(--color-accent)] text-black font-medium"
        >
          Import
        </button>
        <button
          onClick={onClose}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-panel-2)]"
        >
          Cancel
        </button>
      </div>
      <div className="text-[10px] text-[var(--color-muted)] mt-2 leading-snug">
        Accepts <code>{"{ mcpServers: { name: { command/args/env } } }"}</code>{" "}
        — the same format as <code>claude_desktop_config.json</code>. URL
        servers (with <code>url</code> field) also work.
      </div>
    </div>
  );
}

function ExportPanel({
  servers,
  onClose,
}: {
  servers: McpServer[];
  onClose: () => void;
}) {
  const json = stringifyMcpConfig(servers);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        // Fallback for non-secure contexts
        const ta = document.createElement("textarea");
        ta.value = json;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  function downloadJson() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mcp-servers.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-3 mb-3 rounded-lg border border-[var(--color-accent)]/60 bg-[var(--color-panel-2)] p-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
          Export enabled servers ({servers.length})
        </div>
        <button
          onClick={onClose}
          className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          close
        </button>
      </div>
      <pre className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-2 text-[11.5px] font-mono leading-snug max-h-[280px] overflow-auto m-0">
        <code>{json}</code>
      </pre>
      <div className="flex gap-2 mt-2">
        <button
          onClick={copy}
          className="flex-1 text-xs px-2 py-1.5 rounded-md bg-[var(--color-accent)] text-black font-medium"
        >
          {copied ? "Copied ✓" : "Copy to clipboard"}
        </button>
        <button
          onClick={downloadJson}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-panel)]"
        >
          Download
        </button>
      </div>
      <div className="text-[10px] text-[var(--color-muted)] mt-2 leading-snug">
        Claude-Desktop format. Drop under{" "}
        <code>claude_desktop_config.json → mcpServers</code> or paste into any
        MCP-aware client.
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}
