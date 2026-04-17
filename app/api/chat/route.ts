import Anthropic from "@anthropic-ai/sdk";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { NextRequest } from "next/server";
import type {
  ChatRequest,
  ContentBlock,
  McpServerStdio,
  McpServerUrl,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BETA_HEADER = "mcp-client-2025-11-20";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
const OLLAMA_PREFIX = "ollama:";
const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || "http://localhost:11434"
).replace(/\/+$/, "");
const MAX_TURNS = 16;

function slugify(raw: string, fallback: string) {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

function anthropicToolName(serverName: string, toolName: string) {
  // Anthropic tool names must match ^[a-zA-Z0-9_-]{1,128}$
  const combined = `${serverName}__${toolName}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 128);
  return combined || `tool_${Math.random().toString(36).slice(2, 8)}`;
}

type LocalHandle = {
  serverName: string;
  transport: "stdio" | "url";
  client: McpClient;
  close: () => Promise<void>;
};

type LocalToolMap = Map<
  string,
  {
    serverName: string;
    transport: "stdio" | "url";
    originalName: string;
    client: McpClient;
  }
>;

type LocalTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

async function connectStdioServers(
  configs: McpServerStdio[],
  takenNames: Set<string>,
  onLog: (level: "info" | "error", msg: string) => void,
): Promise<{
  handles: LocalHandle[];
  tools: LocalTool[];
  toolMap: LocalToolMap;
}> {
  const handles: LocalHandle[] = [];
  const tools: LocalTool[] = [];
  const toolMap: LocalToolMap = new Map();

  for (const cfg of configs) {
    let baseName = slugify(cfg.name, `stdio-${handles.length + 1}`);
    let name = baseName;
    let k = 2;
    while (takenNames.has(name)) name = `${baseName}-${k++}`;
    takenNames.add(name);

    try {
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args || [],
        env: {
          ...(Object.fromEntries(
            Object.entries(process.env).filter(([, v]) => v !== undefined),
          ) as Record<string, string>),
          ...(cfg.env || {}),
        },
      });
      const client = new McpClient(
        { name: "mcp-switcher", version: "0.1.0" },
        { capabilities: {} },
      );
      await client.connect(transport);

      const listed = await client.listTools();
      for (const t of listed.tools ?? []) {
        const anthropicName = anthropicToolName(name, t.name);
        tools.push({
          name: anthropicName,
          description: t.description ?? "",
          input_schema: (t.inputSchema as Record<string, unknown>) ?? {
            type: "object",
            properties: {},
          },
        });
        toolMap.set(anthropicName, {
          serverName: name,
          transport: "stdio",
          originalName: t.name,
          client,
        });
      }

      handles.push({
        serverName: name,
        transport: "stdio",
        client,
        close: async () => {
          try {
            await client.close();
          } catch {
            /* ignore */
          }
        },
      });
      onLog(
        "info",
        `stdio server "${name}" connected (${listed.tools?.length ?? 0} tools)`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLog("error", `stdio server "${name}" failed to connect: ${msg}`);
    }
  }

  return { handles, tools, toolMap };
}

async function connectUrlServersLocally(
  configs: McpServerUrl[],
  takenNames: Set<string>,
  onLog: (level: "info" | "error", msg: string) => void,
): Promise<{
  handles: LocalHandle[];
  tools: LocalTool[];
  toolMap: LocalToolMap;
}> {
  const handles: LocalHandle[] = [];
  const tools: LocalTool[] = [];
  const toolMap: LocalToolMap = new Map();

  for (const cfg of configs) {
    let baseName = slugify(cfg.name, `url-${handles.length + 1}`);
    let name = baseName;
    let k = 2;
    while (takenNames.has(name)) name = `${baseName}-${k++}`;
    takenNames.add(name);

    try {
      const requestInit: RequestInit = cfg.authorizationToken
        ? { headers: { Authorization: `Bearer ${cfg.authorizationToken}` } }
        : {};
      const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit,
      });
      const client = new McpClient(
        { name: "mcp-switcher", version: "0.1.0" },
        { capabilities: {} },
      );
      await client.connect(transport);

      const listed = await client.listTools();
      for (const t of listed.tools ?? []) {
        const toolName = anthropicToolName(name, t.name);
        tools.push({
          name: toolName,
          description: t.description ?? "",
          input_schema: (t.inputSchema as Record<string, unknown>) ?? {
            type: "object",
            properties: {},
          },
        });
        toolMap.set(toolName, {
          serverName: name,
          transport: "url",
          originalName: t.name,
          client,
        });
      }

      handles.push({
        serverName: name,
        transport: "url",
        client,
        close: async () => {
          try {
            await client.close();
          } catch {
            /* ignore */
          }
        },
      });
      onLog(
        "info",
        `url server "${name}" connected (${listed.tools?.length ?? 0} tools)`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLog("error", `url server "${name}" failed to connect: ${msg}`);
    }
  }

  return { handles, tools, toolMap };
}

async function executeLocalTool(
  mapping: {
    serverName: string;
    transport: "stdio" | "url";
    originalName: string;
    client: McpClient;
  },
  input: unknown,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}> {
  try {
    const raw = await mapping.client.callTool({
      name: mapping.originalName,
      arguments: (input as Record<string, unknown>) ?? {},
    });
    const rawContent = Array.isArray(raw.content) ? raw.content : [];
    const content = rawContent.map((c) => {
      if (
        c &&
        typeof c === "object" &&
        "type" in c &&
        c.type === "text" &&
        typeof (c as { text?: unknown }).text === "string"
      ) {
        return { type: "text" as const, text: (c as { text: string }).text };
      }
      return { type: "text" as const, text: JSON.stringify(c) };
    });
    return { content, isError: Boolean(raw.isError) };
  } catch (e) {
    return {
      content: [
        { type: "text", text: e instanceof Error ? e.message : String(e) },
      ],
      isError: true,
    };
  }
}

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requestedModel = body.model || DEFAULT_MODEL;
  const isOllama = requestedModel.startsWith(OLLAMA_PREFIX);

  if (isOllama) {
    return handleOllama(body, requestedModel.slice(OLLAMA_PREFIX.length));
  }
  return handleAnthropic(body, requestedModel);
}

async function handleAnthropic(body: ChatRequest, model: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const enabled = (body.mcpServers || []).filter((s) => s.enabled);
  const urlConfigs = enabled.filter(
    (s): s is McpServerUrl => s.transport === "url",
  );
  const stdioConfigs = enabled.filter(
    (s): s is McpServerStdio => s.transport === "stdio",
  );

  // Normalise URL server configs for the mcp_servers param
  const urlSeen = new Set<string>();
  const mcpServers = urlConfigs
    .filter((s) => s.url?.startsWith("https://"))
    .map((s, i) => {
      let base = slugify(s.name, `server-${i + 1}`);
      let name = base;
      let k = 2;
      while (urlSeen.has(name)) name = `${base}-${k++}`;
      urlSeen.add(name);
      return {
        type: "url" as const,
        url: s.url,
        name,
        ...(s.authorizationToken
          ? { authorization_token: s.authorizationToken }
          : {}),
      };
    });
  const urlToolsets = mcpServers.map((s) => ({
    type: "mcp_toolset" as const,
    mcp_server_name: s.name,
  }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          /* closed */
        }
      };

      const taken = new Set<string>(urlSeen);
      const { handles, tools: stdioTools, toolMap } = await connectStdioServers(
        stdioConfigs,
        taken,
        (level, msg) => send("log", { level, msg }),
      );

      const tools = [...urlToolsets, ...stdioTools];

      // Working message list; we may append assistant/tool turns as the loop runs.
      const messages = body.messages.slice();

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const createParams: Record<string, unknown> = {
            model,
            max_tokens: 4096,
            messages,
            betas: [BETA_HEADER],
          };
          if (body.system) createParams.system = body.system;
          if (mcpServers.length > 0) createParams.mcp_servers = mcpServers;
          if (tools.length > 0) createParams.tools = tools;

          const response = await (
            anthropic as unknown as {
              beta: {
                messages: {
                  stream: (p: unknown) => AsyncIterable<unknown> & {
                    finalMessage: () => Promise<{
                      stop_reason?: string;
                      content: ContentBlock[];
                    }>;
                  };
                };
              };
            }
          ).beta.messages.stream(createParams);

          for await (const event of response as AsyncIterable<
            Record<string, unknown>
          >) {
            send("raw", event);
          }

          const final = await response.finalMessage();

          // Record assistant turn in working messages
          messages.push({
            role: "assistant",
            content: final.content as ContentBlock[],
          });

          // Collect stdio tool_use blocks from the final message
          const toolUses = (final.content as ContentBlock[]).filter(
            (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
              b.type === "tool_use",
          );

          const stdioToolUses = toolUses.filter((b) => toolMap.has(b.name));

          if (final.stop_reason !== "tool_use" || stdioToolUses.length === 0) {
            send("final", final);
            send("done", {});
            break;
          }

          // Execute each stdio tool call locally and emit synthetic result events.
          const toolResults: Array<{
            type: "tool_result";
            tool_use_id: string;
            content: Array<{ type: "text"; text: string }>;
            is_error: boolean;
          }> = [];

          for (const tu of stdioToolUses) {
            const mapping = toolMap.get(tu.name)!;
            const { content, isError } = await executeLocalTool(
              mapping,
              tu.input,
            );

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content,
              is_error: isError,
            });

            send("tool_result", {
              tool_use_id: tu.id,
              server_name: mapping.serverName,
              name: mapping.originalName,
              is_error: isError,
              content,
            });
          }

          // Feed results back as the next user turn
          messages.push({
            role: "user",
            content: toolResults as unknown as ContentBlock[],
          });

          if (turn === MAX_TURNS - 1) {
            send("error", {
              status: 500,
              message: `Exceeded MAX_TURNS=${MAX_TURNS} without stop.`,
            });
          }
        }
      } catch (err) {
        const e = err as { status?: number; message?: string; error?: unknown };
        send("error", {
          status: e.status ?? 500,
          message: e.message ?? "Unknown error",
          detail: e.error ?? null,
        });
      } finally {
        await Promise.all(handles.map((h) => h.close()));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------- Ollama ----------

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

function messagesToOpenAI(
  input: ChatRequest["messages"],
  system?: string,
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of input) {
    if (typeof m.content === "string") {
      if (m.role === "user") out.push({ role: "user", content: m.content });
      else out.push({ role: "assistant", content: m.content });
      continue;
    }

    const blocks = m.content;

    if (m.role === "assistant") {
      let text = "";
      const toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }> = [];
      for (const b of blocks) {
        if (b.type === "text") text += b.text;
        else if (b.type === "tool_use") {
          toolCalls.push({
            id: b.id,
            type: "function",
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input ?? {}),
            },
          });
        }
      }
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // user role: may contain tool_result blocks that map to role:"tool" msgs
      for (const b of blocks) {
        if (b.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: b.tool_use_id,
            content: (b.content || []).map((c) => c.text).join("\n"),
          });
        } else if (b.type === "text") {
          out.push({ role: "user", content: b.text });
        }
      }
    }
  }
  return out;
}

function toolsToOpenAI(tools: LocalTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters:
        (t.input_schema as Record<string, unknown>) ?? {
          type: "object",
          properties: {},
        },
    },
  }));
}

async function handleOllama(body: ChatRequest, model: string) {
  const enabled = (body.mcpServers || []).filter((s) => s.enabled);
  const urlConfigs = enabled.filter(
    (s): s is McpServerUrl => s.transport === "url",
  );
  const stdioConfigs = enabled.filter(
    (s): s is McpServerStdio => s.transport === "stdio",
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          /* closed */
        }
      };

      const taken = new Set<string>();
      const handles: LocalHandle[] = [];
      const tools: LocalTool[] = [];
      const toolMap: LocalToolMap = new Map();

      const stdio = await connectStdioServers(stdioConfigs, taken, (l, m) =>
        send("log", { level: l, msg: m }),
      );
      handles.push(...stdio.handles);
      tools.push(...stdio.tools);
      for (const [k, v] of stdio.toolMap) toolMap.set(k, v);

      const url = await connectUrlServersLocally(urlConfigs, taken, (l, m) =>
        send("log", { level: l, msg: m }),
      );
      handles.push(...url.handles);
      tools.push(...url.tools);
      for (const [k, v] of url.toolMap) toolMap.set(k, v);

      const openAiTools = toolsToOpenAI(tools);
      const messages = messagesToOpenAI(body.messages, body.system);

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const assistantMsg = await streamOllamaTurn({
            baseUrl: OLLAMA_BASE_URL,
            model,
            messages,
            tools: openAiTools,
            toolMap,
            send,
          });

          messages.push(assistantMsg);

          if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
            send("final", {
              stop_reason: "end_turn",
              content: [
                { type: "text", text: assistantMsg.content ?? "" },
              ],
            });
            send("done", {});
            break;
          }

          for (const tc of assistantMsg.tool_calls) {
            const mapping = toolMap.get(tc.function.name);
            if (!mapping) {
              const errContent = [
                {
                  type: "text" as const,
                  text: `Unknown tool: ${tc.function.name}`,
                },
              ];
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: errContent[0].text,
              });
              send("tool_result", {
                tool_use_id: tc.id,
                server_name: "unknown",
                name: tc.function.name,
                is_error: true,
                content: errContent,
              });
              continue;
            }

            let input: unknown = {};
            try {
              input = tc.function.arguments
                ? JSON.parse(tc.function.arguments)
                : {};
            } catch {
              input = { _raw: tc.function.arguments };
            }

            const { content, isError } = await executeLocalTool(
              mapping,
              input,
            );

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: content.map((c) => c.text).join("\n"),
            });

            send("tool_result", {
              tool_use_id: tc.id,
              server_name: mapping.serverName,
              name: mapping.originalName,
              is_error: isError,
              content,
            });
          }

          if (turn === MAX_TURNS - 1) {
            send("error", {
              status: 500,
              message: `Exceeded MAX_TURNS=${MAX_TURNS} without stop.`,
            });
          }
        }
      } catch (err) {
        const e = err as { status?: number; message?: string };
        send("error", {
          status: e.status ?? 500,
          message: e.message ?? "Unknown error",
        });
      } finally {
        await Promise.all(handles.map((h) => h.close()));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

type OpenAIDeltaToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: OpenAIDeltaToolCall[];
    };
    finish_reason?: string | null;
  }>;
};

async function streamOllamaTurn(opts: {
  baseUrl: string;
  model: string;
  messages: OpenAIMessage[];
  tools: ReturnType<typeof toolsToOpenAI>;
  toolMap: LocalToolMap;
  send: (event: string, data: unknown) => void;
}): Promise<
  Extract<OpenAIMessage, { role: "assistant" }>
> {
  const { baseUrl, model, messages, tools, send, toolMap } = opts;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(tools.length > 0 ? { tools } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${res.status}): ${text || res.statusText}`,
    );
  }

  // Bump turn counter on the client
  send("raw", { type: "message_start" });

  // Text streaming state
  let textOpen = false;
  let textIndex = 0;
  let accumText = "";

  // Tool-call streaming state: aggregate by index
  type AccTC = {
    id: string;
    name: string;
    args: string;
    uiIndex: number; // content_block index on the UI side
    started: boolean;
  };
  const toolAcc = new Map<number, AccTC>();
  let nextBlockIndex = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const openText = () => {
    if (textOpen) return;
    textIndex = nextBlockIndex++;
    send("raw", {
      type: "content_block_start",
      index: textIndex,
      content_block: { type: "text", text: "" },
    });
    textOpen = true;
  };
  const closeText = () => {
    if (!textOpen) return;
    send("raw", { type: "content_block_stop", index: textIndex });
    textOpen = false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(data) as OpenAIStreamChunk;
      } catch {
        continue;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};

      if (typeof delta.content === "string" && delta.content.length > 0) {
        openText();
        accumText += delta.content;
        send("raw", {
          type: "content_block_delta",
          index: textIndex,
          delta: { type: "text_delta", text: delta.content },
        });
      }

      if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
        // A tool call starting implies text (if any) is done
        closeText();
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === "number" ? tc.index : 0;
          let acc = toolAcc.get(idx);
          if (!acc) {
            acc = {
              id: tc.id || `call_${idx}`,
              name: tc.function?.name || "",
              args: "",
              uiIndex: nextBlockIndex++,
              started: false,
            };
            toolAcc.set(idx, acc);
          }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;

          if (!acc.started && acc.name) {
            send("raw", {
              type: "content_block_start",
              index: acc.uiIndex,
              content_block: {
                type: "tool_use",
                id: acc.id,
                name: acc.name,
                input: {},
              },
            });
            acc.started = true;
          }

          if (typeof tc.function?.arguments === "string" && acc.started) {
            acc.args += tc.function.arguments;
            send("raw", {
              type: "content_block_delta",
              index: acc.uiIndex,
              delta: {
                type: "input_json_delta",
                partial_json: tc.function.arguments,
              },
            });
          } else if (typeof tc.function?.arguments === "string") {
            // Not started yet (name missing) — buffer args silently
            acc.args += tc.function.arguments;
          }
        }
      }

      if (choice.finish_reason) {
        // End of message — close any open blocks below
      }
    }
  }

  closeText();
  for (const acc of toolAcc.values()) {
    if (acc.started) {
      send("raw", { type: "content_block_stop", index: acc.uiIndex });
    }
  }
  send("raw", { type: "message_stop" });

  // Build the assistant message for the next iteration
  const toolCalls = Array.from(toolAcc.values())
    .filter((a) => a.name)
    .map((a) => ({
      id: a.id,
      type: "function" as const,
      function: { name: a.name, arguments: a.args || "{}" },
    }));

  // Drop unknown tools rather than fail silently — surface via log for debugging
  for (const tc of toolCalls) {
    if (!toolMap.has(tc.function.name)) {
      opts.send("log", {
        level: "error",
        msg: `ollama requested unknown tool "${tc.function.name}"`,
      });
    }
  }

  return {
    role: "assistant",
    content: accumText || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}
