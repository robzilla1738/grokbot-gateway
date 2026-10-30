import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import { GrokBotClient } from "../client/index.js";
import { dispatchTool, type Gateway } from "../gateway.js";
import { localActor } from "../security/tokens.js";
import type { Actor } from "../types.js";
import { PRODUCT_NAME, VERSION } from "../version.js";
import { TOOL_DEFINITIONS } from "./tools.js";

function rawShape(schema: z.ZodType): ZodRawShape {
  if (schema instanceof z.ZodObject) {
    return schema.shape as ZodRawShape;
  }
  return {};
}

export function createTypedMcpServer(gateway: Gateway): McpServer {
  const server = new McpServer({ name: PRODUCT_NAME, version: VERSION });
  for (const tool of TOOL_DEFINITIONS) {
    const shape = rawShape(tool.inputSchema);
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: shape },
      async (args) => dispatchTool(gateway, tool.name, (args ?? {}) as Record<string, unknown>)
    );
  }
  return server;
}

export async function startStdioMcp(client?: GrokBotClient, actor?: Actor): Promise<void> {
  const gateway: Gateway = {
    client: client ?? new GrokBotClient(),
    actor: actor ?? localActor("mcp-stdio")
  };
  const server = createTypedMcpServer(gateway);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
