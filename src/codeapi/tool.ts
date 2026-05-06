// The single MCP tool exposed in code-api mode (PR #10).
//
// In code-api mode the server publishes only this tool. Calling it
// returns the path to the generated TypeScript stubs and a short
// usage example; the agent then drives Jira through those stubs in
// its own execution environment (Claude Code's Bash + tsx, etc.) and
// never calls an MCP tool again for reads.
//
// The handler is stateless — the heavy lifting (stub generation +
// bridge startup) happens once at server boot in `src/index.ts`. We
// just describe to the agent what was set up.

export interface CodeApiToolContext {
  apiDir: string;        // absolute path to generated `api/`
  socketAddress: string; // value placed in JIRA_MCP_SOCKET
}

export const JIRA_CODE_API_TOOL_NAME = "jira_code_api";

// Description text rendered in the MCP tool listing. Kept tight so
// the listing token cost stays under the ~500-token target the plan
// quotes for Layer 3.
export const JIRA_CODE_API_TOOL_DESCRIPTION =
  "Access Jira via TypeScript. Call once to get the on-disk API path, " +
  "then `import` the generated stubs in your shell (tsx) — every call " +
  "returns a Ref<T> with a trimmed summary inline and the full response " +
  "on disk for when you need it.";

export const jiraCodeApiToolDefinition = {
  name: JIRA_CODE_API_TOOL_NAME,
  description: JIRA_CODE_API_TOOL_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
} as const;

// Body returned by a successful invocation. Stays under 1KB so the
// agent's first call doesn't blow the budget the rest of the session
// is supposed to save.
export interface CodeApiToolResponse {
  apiDir: string;
  rootIndex: string;
  socketEnv: string;
  socketAddress: string;
  usage: string;
}

export function buildCodeApiToolResponse(
  ctx: CodeApiToolContext,
): CodeApiToolResponse {
  // The agent typically runs this via Claude Code's Bash tool, whose
  // child shells *do not* inherit env vars from the MCP server
  // process. So the snippet must export JIRA_MCP_SOCKET inline rather
  // than assume it's already set. tsx is the recommended runner — it
  // executes the .ts stubs directly.
  //
  // The body wraps in an async IIFE because `tsx -e` transforms the
  // snippet under esbuild's CJS target by default, where top-level
  // await is illegal. The IIFE keeps the snippet portable across
  // every cwd / package.json layout the agent might run in.
  // The discovery hint, common-ops list, and subtask note exist
  // because real first-use sessions burned 4-5 calls guessing at the
  // wrong endpoint names ("searchAndReconsileIssuesUsingJql") and
  // wrong subtask strategies ("issueLinkType = has subtask"). The
  // function shape is `jira.<resource>.<operation>` — `ls` the apiDir
  // for resources, then read the operation file's *Args interface.
  //
  // The advertised import points at `index.ts` (what the generator
  // actually writes), not `index.js`. tsx normally rewrites .js → .ts,
  // but its resolver skips that rewrite for paths under
  // /node_modules/ when invoked inside a TS project. Since the apiDir
  // typically lives under ~/.npm/_npx/.../node_modules/jira-mcp/...,
  // advertising .js made the import fail from any cwd with a
  // tsconfig.json. Pointing at .ts directly avoids the heuristic.
  const usage = [
    `# tsx required. JIRA_MCP_SOCKET prefix is load-bearing — child`,
    `# shells don't inherit the MCP server's env.`,
    `JIRA_MCP_SOCKET=${ctx.socketAddress} npx tsx -e '`,
    `import * as jira from "${ctx.apiDir}/index.ts";`,
    `import { readFile } from "fs/promises";`,
    `(async () => {`,
    `  const r = await jira.issue.get({ issueIdOrKey: "PROJ-1" });`,
    `  console.log(r.summary);  // trimmed projection`,
    `  const full = JSON.parse(await readFile(r.ref, "utf8"));`,
    `})();'`,
    `# Shape: jira.<resource>.<op>. ls apiDir for resources, then`,
    `# read <resource>/<op>.ts for the *Args interface. Common ops:`,
    `# issue.{get,create,update,transition}, search.issues, comment.*.`,
    `# Subtasks: use \`parent = KEY\` JQL, not "has subtask" link type.`,
  ].join("\n");

  return {
    apiDir: ctx.apiDir,
    rootIndex: `${ctx.apiDir}/index.ts`,
    socketEnv: "JIRA_MCP_SOCKET",
    socketAddress: ctx.socketAddress,
    usage,
  };
}
