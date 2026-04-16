"use client";

import type { ChatMessage, ContentBlock } from "@/lib/types";
import { useState } from "react";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} px-6 py-3`}>
      <div
        className={`max-w-[780px] w-fit ${
          isUser
            ? "bg-[var(--color-accent)] text-black"
            : "bg-[var(--color-panel)] border border-[var(--color-border)]"
        } rounded-2xl px-4 py-3 shadow-sm`}
      >
        <div className="prose-chat text-[14.5px] leading-relaxed whitespace-pre-wrap">
          {message.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
          {message.blocks.length === 0 && !isUser && <TypingDots />}
        </div>
      </div>
    </div>
  );
}

function BlockView({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    return <span>{block.text}</span>;
  }
  if (block.type === "mcp_tool_use" || block.type === "tool_use") {
    return (
      <ToolUseCard
        transport={block.type === "mcp_tool_use" ? "url" : "stdio"}
        serverName={block.server_name || "stdio"}
        name={block.name}
        input={block.input}
      />
    );
  }
  if (block.type === "mcp_tool_result" || block.type === "tool_result") {
    return (
      <ToolResultCard
        isError={block.is_error}
        content={block.content}
        transport={block.type === "mcp_tool_result" ? "url" : "stdio"}
      />
    );
  }
  return null;
}

function ToolUseCard({
  transport,
  serverName,
  name,
  input,
}: {
  transport: "url" | "stdio";
  serverName: string;
  name: string;
  input: unknown;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] text-[var(--color-text)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ToolIcon />
          <span className="text-xs text-[var(--color-muted)]">tool call</span>
          <TransportPill transport={transport} />
          <span className="text-xs truncate">
            <span className="text-[var(--color-accent)]">{serverName}</span>
            <span className="text-[var(--color-muted)]"> · </span>
            <span>{name}</span>
          </span>
        </div>
        <span className="text-[var(--color-muted)] text-xs">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <pre className="border-t border-[var(--color-border)] m-0 rounded-none">
          <code>{JSON.stringify(input, null, 2)}</code>
        </pre>
      )}
    </div>
  );
}

function ToolResultCard({
  isError,
  content,
  transport,
}: {
  isError: boolean;
  content: Array<{ type: "text"; text: string }>;
  transport: "url" | "stdio";
}) {
  const [open, setOpen] = useState(false);
  const text = content.map((c) => c.text).join("\n");
  const preview = text.slice(0, 140);
  return (
    <div
      className={`my-2 rounded-lg border ${
        isError
          ? "border-red-500/50 bg-red-500/5"
          : "border-[var(--color-border)] bg-[var(--color-panel-2)]"
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ResultIcon error={isError} />
          <span className="text-xs text-[var(--color-muted)]">
            {isError ? "tool error" : "tool result"}
          </span>
          <TransportPill transport={transport} />
          <span className="text-xs truncate text-[var(--color-muted)]">
            {preview}
            {text.length > preview.length ? "…" : ""}
          </span>
        </div>
        <span className="text-[var(--color-muted)] text-xs">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <pre className="border-t border-[var(--color-border)] m-0 rounded-none max-h-[360px] overflow-auto">
          <code>{text}</code>
        </pre>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-[var(--color-muted)]">
      <span className="dot">●</span>
      <span className="dot">●</span>
      <span className="dot">●</span>
    </span>
  );
}

function TransportPill({ transport }: { transport: "url" | "stdio" }) {
  const isUrl = transport === "url";
  return (
    <span
      className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-[1px] rounded ${
        isUrl
          ? "bg-sky-500/15 text-sky-300"
          : "bg-amber-500/15 text-amber-300"
      }`}
    >
      {transport}
    </span>
  );
}

function ToolIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--color-accent)]">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6 2 2 6-6a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6Z" />
    </svg>
  );
}

function ResultIcon({ error }: { error: boolean }) {
  return error ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
