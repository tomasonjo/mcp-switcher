import Anthropic from "@anthropic-ai/sdk";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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

type StdioHandle = {
  serverName: string;
  client: McpClient;
  close: () => Promise<void>;
};

type StdioToolMap = Map<
  string,
  { serverName: string; originalName: string; client: McpClient }
>;

async function connectStdioServers(
  configs: McpServerStdio[],
  onLog: (level: "info" | "error", msg: string) => void,
): Promise<{
  handles: StdioHandle[];
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  toolMap: StdioToolMap;
  serverNames: Map<string, string>;
}> {
  const handles: StdioHandle[] = [];
  const tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> = [];
  const toolMap: StdioToolMap = new Map();
  const serverNames = new Map<string, string>();
  const seenNames = new Set<string>();

  for (const cfg of configs) {
    let baseName = slugify(cfg.name, `stdio-${handles.length + 1}`);
    let name = baseName;
    let k = 2;
    while (seenNames.has(name)) name = `${baseName}-${k++}`;
    seenNames.add(name);
    serverNames.set(cfg.id, name);

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
          originalName: t.name,
          client,
        });
      }

      handles.push({
        serverName: name,
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

  return { handles, tools, toolMap, serverNames };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
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

      const { handles, tools: stdioTools, toolMap } = await connectStdioServers(
        stdioConfigs,
        (level, msg) => send("log", { level, msg }),
      );

      const tools = [...urlToolsets, ...stdioTools];

      // Working message list; we may append assistant/tool turns as the loop runs.
      const messages = body.messages.slice();

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const createParams: Record<string, unknown> = {
            model: body.model || DEFAULT_MODEL,
            max_tokens: 4096,
            messages,
            betas: [BETA_HEADER],
          };
          if (body.system) createParams.system = body.system;
          if (mcpServers.length > 0) createParams.mcp_servers = mcpServers;
          if (tools.length > 0) createParams.tools = tools;

          const response = await (anthropic as unknown as {
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
          }).beta.messages.stream(createParams);

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
            let content: Array<{ type: "text"; text: string }> = [];
            let isError = false;
            try {
              const raw = await mapping.client.callTool({
                name: mapping.originalName,
                arguments: (tu.input as Record<string, unknown>) ?? {},
              });
              const rawContent = Array.isArray(raw.content) ? raw.content : [];
              content = rawContent.map((c) => {
                if (c && typeof c === "object" && "type" in c && c.type === "text" && typeof (c as { text?: unknown }).text === "string") {
                  return { type: "text" as const, text: (c as { text: string }).text };
                }
                return { type: "text" as const, text: JSON.stringify(c) };
              });
              isError = Boolean(raw.isError);
            } catch (e) {
              isError = true;
              content = [
                {
                  type: "text",
                  text: e instanceof Error ? e.message : String(e),
                },
              ];
            }

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
