export type McpServerUrl = {
  id: string;
  transport: "url";
  name: string;
  url: string;
  authorizationToken?: string;
  enabled: boolean;
};

export type McpServerStdio = {
  id: string;
  transport: "stdio";
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};

export type McpServer = McpServerUrl | McpServerStdio;

export type ChatRole = "user" | "assistant";

export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "mcp_tool_use";
      id: string;
      name: string;
      server_name: string;
      input: unknown;
    }
  | {
      type: "mcp_tool_result";
      tool_use_id: string;
      is_error: boolean;
      content: Array<{ type: "text"; text: string }>;
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      // UI-only: never sent back to the Anthropic API on regular tool_use blocks.
      server_name?: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      is_error: boolean;
      content: Array<{ type: "text"; text: string }>;
    };

export type ChatMessage = {
  id: string;
  role: ChatRole;
  blocks: ContentBlock[];
};

export type ChatRequest = {
  model?: string;
  system?: string;
  messages: { role: ChatRole; content: string | ContentBlock[] }[];
  mcpServers: McpServer[];
};
