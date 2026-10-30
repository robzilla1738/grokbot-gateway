export function claudeAndCursorJson(): string {
  return JSON.stringify(
    {
      mcpServers: {
        grokbot: {
          command: "grokbot",
          args: ["mcp"]
        }
      }
    },
    null,
    2
  );
}

export function codexToml(): string {
  return `[mcp_servers.grokbot]
command = "grokbot"
args = ["mcp"]
`;
}

export function formatMcpCopyPaste(): string[] {
  return [
    "Claude Code (~/.claude.json or .mcp.json) and Cursor (.cursor/mcp.json):",
    claudeAndCursorJson(),
    "",
    "Codex (~/.codex/config.toml):",
    codexToml(),
    "A stdio MCP process can message your bots as you. Do not commit a gateway token."
  ];
}
