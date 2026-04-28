import { describe, expect, it } from "vitest";

import {
  buildCodeApiToolResponse,
  jiraCodeApiToolDefinition,
  JIRA_CODE_API_TOOL_NAME,
} from "../../src/codeapi/tool.js";

describe("jiraCodeApiToolDefinition", () => {
  it("uses the canonical tool name and an empty input schema", () => {
    expect(jiraCodeApiToolDefinition.name).toBe(JIRA_CODE_API_TOOL_NAME);
    expect(jiraCodeApiToolDefinition.name).toBe("jira_code_api");
    expect(jiraCodeApiToolDefinition.inputSchema).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("keeps the description tight (under 500 chars) for tool-list cost", () => {
    expect(jiraCodeApiToolDefinition.description.length).toBeLessThan(500);
  });
});

describe("buildCodeApiToolResponse", () => {
  it("surfaces the api dir, root index, socket env name + value, and a usage example", () => {
    const out = buildCodeApiToolResponse({
      apiDir: "/tmp/jira-mcp/abc/api",
      socketAddress: "/tmp/jira-mcp/abc/ipc.sock",
    });
    expect(out.apiDir).toBe("/tmp/jira-mcp/abc/api");
    expect(out.rootIndex).toBe("/tmp/jira-mcp/abc/api/index.js");
    expect(out.socketEnv).toBe("JIRA_MCP_SOCKET");
    expect(out.socketAddress).toBe("/tmp/jira-mcp/abc/ipc.sock");
    expect(out.usage).toContain('import * as jira from "/tmp/jira-mcp/abc/api/index.js"');
    expect(out.usage).toContain("issue.get");
    expect(out.usage).toContain(".summary");
    expect(out.usage).toContain(".ref");
  });

  it("stays under 1KB so the tool's first call doesn't blow the budget", () => {
    const out = buildCodeApiToolResponse({
      apiDir: "/tmp/jira-mcp/abcdef/api",
      socketAddress: "/tmp/jira-mcp/abcdef/ipc.sock",
    });
    const serialized = JSON.stringify(out);
    expect(serialized.length).toBeLessThan(1024);
  });
});
