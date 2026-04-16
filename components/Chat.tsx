"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ContentBlock, McpServer } from "@/lib/types";
import { MessageBubble } from "./Message";
import { randomId } from "@/lib/storage";

type Props = {
  servers: McpServer[];
  model: string;
};

export function Chat({ servers, model }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ level: "info" | "error"; msg: string }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const enabled = useMemo(() => servers.filter((s) => s.enabled), [servers]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    if (!input.trim() || busy) return;
    setError(null);
    setLogs([]);

    const userMsg: ChatMessage = {
      id: randomId(),
      role: "user",
      blocks: [{ type: "text", text: input.trim() }],
    };
    const assistantMsg: ChatMessage = {
      id: randomId(),
      role: "assistant",
      blocks: [],
    };

    const nextMessages = [...messages, userMsg, assistantMsg];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);

    const apiMessages = buildApiMessages(nextMessages.slice(0, -1));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          messages: apiMessages,
          mcpServers: enabled,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Request failed (${res.status}): ${text || res.statusText}`,
        );
      }

      await consumeStream(
        res.body,
        (patch) => {
          setMessages((cur) => {
            const copy = cur.slice();
            const idx = copy.findIndex((m) => m.id === assistantMsg.id);
            if (idx === -1) return copy;
            copy[idx] = { ...copy[idx], blocks: patch(copy[idx].blocks) };
            return copy;
          });
        },
        (log) => setLogs((ls) => [...ls, log]),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  function clearChat() {
    if (busy) stop();
    setMessages([]);
    setError(null);
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full">
      <TopBar
        enabledCount={enabled.length}
        totalCount={servers.length}
        onClear={clearChat}
        canClear={messages.length > 0}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? <EmptyState enabled={enabled} /> : null}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {logs.length > 0 && (
          <div className="mx-6 my-2 text-[11px] space-y-1">
            {logs.map((l, i) => (
              <div
                key={i}
                className={`rounded border px-2.5 py-1.5 ${
                  l.level === "error"
                    ? "border-red-500/40 bg-red-500/5 text-red-300"
                    : "border-[var(--color-border)] bg-[var(--color-panel-2)] text-[var(--color-muted)]"
                }`}
              >
                <span className="uppercase tracking-wider mr-2 text-[9px] opacity-80">
                  {l.level === "error" ? "stdio error" : "stdio"}
                </span>
                {l.msg}
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="mx-6 my-3 text-xs text-red-300 border border-red-500/40 bg-red-500/5 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={send}
        onStop={stop}
        busy={busy}
      />
    </div>
  );
}

function TopBar({
  enabledCount,
  totalCount,
  onClear,
  canClear,
}: {
  enabledCount: number;
  totalCount: number;
  onClear: () => void;
  canClear: boolean;
}) {
  return (
    <div className="h-12 border-b border-[var(--color-border)] flex items-center justify-between px-5 bg-[var(--color-panel)]/60 backdrop-blur">
      <div className="text-sm text-[var(--color-muted)]">
        <span className="text-[var(--color-text)] font-medium">Chat</span>
        <span className="mx-2">·</span>
        {enabledCount > 0 ? (
          <>
            <span className="text-[var(--color-accent)]">{enabledCount}</span> MCP
            server{enabledCount === 1 ? "" : "s"} active
          </>
        ) : (
          <>no MCP servers active{totalCount > 0 ? " (toggle in sidebar)" : ""}</>
        )}
      </div>
      <button
        disabled={!canClear}
        onClick={onClear}
        className="text-xs px-2.5 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-panel-2)] disabled:opacity-40"
      >
        New chat
      </button>
    </div>
  );
}

function EmptyState({ enabled }: { enabled: McpServer[] }) {
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-[var(--color-accent)]/20 flex items-center justify-center mb-4">
          <div className="w-6 h-6 rounded bg-[var(--color-accent)]" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          Start a conversation
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1.5">
          Ask anything. Toggle MCP servers in the sidebar to choose which tools
          Claude can use this turn.
        </p>
        {enabled.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {enabled.map((s) => (
              <span
                key={s.id}
                className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              >
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [value]);

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-panel)]/60 px-5 py-3">
      <div className="max-w-[880px] mx-auto flex items-end gap-2 bg-[var(--color-panel-2)] border border-[var(--color-border)] rounded-2xl px-3 py-2 focus-within:border-[var(--color-accent)] transition-colors">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={1}
          placeholder="Message Claude… (Shift+Enter for newline)"
          className="flex-1 bg-transparent outline-none resize-none text-sm leading-6 py-1.5 placeholder:text-[var(--color-muted)]"
        />
        {busy ? (
          <button
            onClick={onStop}
            className="h-9 px-3 rounded-lg bg-[var(--color-border)] hover:bg-[var(--color-panel)] text-xs"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!value.trim()}
            className="h-9 w-9 rounded-lg bg-[var(--color-accent)] text-black disabled:opacity-40 flex items-center justify-center"
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
        )}
      </div>
      <div className="max-w-[880px] mx-auto text-[11px] text-[var(--color-muted)] mt-1.5 px-2">
        Uses the beta <code>mcp-client-2025-11-20</code> connector · Anthropic
      </div>
    </div>
  );
}

type BlockAccum = {
  block: ContentBlock;
  partialJson?: string;
};

type ApiMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

/**
 * UI messages store all blocks (text, tool_use, tool_result, mcp_*) in a
 * single assistant bubble. The Anthropic API requires stdio tool_result blocks
 * to live in a user turn following the assistant's tool_use turn. This splits
 * each stored assistant message into the proper assistant/user alternation and
 * strips UI-only fields (`server_name` on `tool_use`) that the API rejects.
 */
function buildApiMessages(messages: ChatMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];

  for (const m of messages) {
    if (m.role === "user") {
      if (m.blocks.length === 1 && m.blocks[0].type === "text") {
        out.push({ role: "user", content: m.blocks[0].text });
      } else {
        out.push({ role: "user", content: m.blocks.map(sanitizeBlock) });
      }
      continue;
    }

    // assistant: may contain stdio tool_result blocks that need to move to
    // their own user turn. Adjacent tool_results collapse into one user turn.
    let asst: ContentBlock[] = [];
    let usrResults: ContentBlock[] = [];

    const flushAsst = () => {
      if (asst.length) {
        out.push({ role: "assistant", content: asst.map(sanitizeBlock) });
        asst = [];
      }
    };
    const flushUsr = () => {
      if (usrResults.length) {
        out.push({ role: "user", content: usrResults.map(sanitizeBlock) });
        usrResults = [];
      }
    };

    for (const b of m.blocks) {
      if (b.type === "tool_result") {
        flushAsst();
        usrResults.push(b);
      } else {
        flushUsr();
        asst.push(b);
      }
    }
    flushAsst();
    flushUsr();
  }

  return out;
}

function sanitizeBlock(b: ContentBlock): ContentBlock {
  // Our UI attaches `server_name` to regular tool_use blocks for display, but
  // the Messages API rejects it — it's only valid on mcp_tool_use.
  if (b.type === "tool_use") {
    return { type: "tool_use", id: b.id, name: b.name, input: b.input };
  }
  return b;
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  patch: (fn: (cur: ContentBlock[]) => ContentBlock[]) => void,
  onLog: (log: { level: "info" | "error"; msg: string }) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  // Keyed by a composite of (turn, index) so the second turn's index 0 doesn't
  // collide with the first turn's index 0.
  const accum: Record<string, BlockAccum> = {};
  let turn = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const parts = buf.split("\n\n");
    buf = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;

      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      if (event === "raw") {
        const ev = payload as Record<string, unknown>;
        if (ev.type === "message_start") turn += 1;
        handleRawEvent(ev, turn, accum, patch);
      } else if (event === "log") {
        onLog(payload as { level: "info" | "error"; msg: string });
      } else if (event === "tool_result") {
        const p = payload as {
          tool_use_id: string;
          server_name: string;
          is_error: boolean;
          content: Array<{ type: "text"; text: string }>;
        };
        patch((cur) => [
          ...cur,
          {
            type: "tool_result",
            tool_use_id: p.tool_use_id,
            is_error: p.is_error,
            content: p.content,
          },
        ]);
      } else if (event === "error") {
        const e = payload as { message?: string };
        throw new Error(e.message || "Stream error");
      }
    }
  }
}

function handleRawEvent(
  ev: Record<string, unknown>,
  turn: number,
  accum: Record<string, BlockAccum>,
  patch: (fn: (cur: ContentBlock[]) => ContentBlock[]) => void,
) {
  const type = ev.type as string | undefined;
  const key = (i: number) => `${turn}:${i}`;

  if (type === "content_block_start") {
    const index = ev.index as number;
    const block = ev.content_block as Record<string, unknown>;

    if (block?.type === "text") {
      const b: ContentBlock = { type: "text", text: (block.text as string) || "" };
      accum[key(index)] = { block: b };
      patch((cur) => [...cur, { type: "text", text: "" }]);
      return;
    }
    if (block?.type === "mcp_tool_use") {
      const b: ContentBlock = {
        type: "mcp_tool_use",
        id: (block.id as string) || "",
        name: (block.name as string) || "",
        server_name: (block.server_name as string) || "",
        input: block.input ?? {},
      };
      accum[key(index)] = { block: b };
      patch((cur) => [...cur, b]);
      return;
    }
    if (block?.type === "mcp_tool_result") {
      const b: ContentBlock = {
        type: "mcp_tool_result",
        tool_use_id: (block.tool_use_id as string) || "",
        is_error: Boolean(block.is_error),
        content: (block.content as Array<{ type: "text"; text: string }>) || [],
      };
      accum[key(index)] = { block: b };
      patch((cur) => [...cur, b]);
      return;
    }
    if (block?.type === "tool_use") {
      const b: ContentBlock = {
        type: "tool_use",
        id: (block.id as string) || "",
        name: (block.name as string) || "",
        server_name: inferServerFromToolName((block.name as string) || ""),
        input: {},
      };
      accum[key(index)] = { block: b, partialJson: "" };
      patch((cur) => [...cur, b]);
      return;
    }
  }

  if (type === "content_block_delta") {
    const index = ev.index as number;
    const delta = ev.delta as Record<string, unknown>;
    const entry = accum[key(index)];
    if (!entry) return;

    if (delta?.type === "text_delta" && entry.block.type === "text") {
      entry.block = {
        type: "text",
        text: entry.block.text + ((delta.text as string) || ""),
      };
      const snap = entry.block.text;
      patch((cur) => replaceTextAt(cur, turn, index, snap));
      return;
    }
    if (delta?.type === "input_json_delta" && entry.block.type === "tool_use") {
      entry.partialJson = (entry.partialJson || "") + ((delta.partial_json as string) || "");
      return;
    }
  }

  if (type === "content_block_stop") {
    const index = ev.index as number;
    const entry = accum[key(index)];
    if (!entry) return;

    if (entry.block.type === "tool_use" && entry.partialJson !== undefined) {
      let parsed: unknown = {};
      try {
        parsed = entry.partialJson ? JSON.parse(entry.partialJson) : {};
      } catch {
        parsed = { _raw: entry.partialJson };
      }
      const finalised: ContentBlock = { ...entry.block, input: parsed };
      entry.block = finalised;
      patch((cur) => replaceBlockById(cur, "tool_use", (entry.block as { id: string }).id, finalised));
    }
  }
}

function inferServerFromToolName(name: string): string {
  const idx = name.indexOf("__");
  return idx > 0 ? name.slice(0, idx) : "stdio";
}

function replaceTextAt(
  cur: ContentBlock[],
  turn: number,
  index: number,
  text: string,
): ContentBlock[] {
  // Find the matching text block by walking backward from the end, counting
  // text blocks added during this turn. Simplest: replace the last text block.
  const out = cur.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].type === "text") {
      out[i] = { type: "text", text };
      return out;
    }
  }
  out.push({ type: "text", text });
  return out;
  // turn + index intentionally not used; kept for signature stability.
  void turn;
  void index;
}

function replaceBlockById(
  cur: ContentBlock[],
  type: "tool_use" | "mcp_tool_use",
  id: string,
  next: ContentBlock,
): ContentBlock[] {
  const out = cur.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const b = out[i];
    if (b.type === type && "id" in b && b.id === id) {
      out[i] = next;
      return out;
    }
  }
  return out;
}
