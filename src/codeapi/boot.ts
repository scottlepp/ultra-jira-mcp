// Code-api startup glue.
//
// Pulled out of `src/index.ts` so the wiring (cleanup → resolve
// static api dir → start bridge → publish socket env var) is
// testable in isolation, without standing up the MCP transport.
//
// The api/ directory is built once at `npm run build` time
// (scripts/build-api.ts) and ships in the package. Per-session
// uniqueness is handled entirely by JIRA_MCP_SOCKET, which the
// generated _client.ts reads at invoke time.

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { JiraClient } from "../auth/jira-client.js";
import { operations } from "../core/operations.js";
import { cleanupStaleSessions } from "../core/sandbox.js";
import { startBridge, type BridgeServer } from "./bridge.js";
import type { CodeApiToolContext } from "./tool.js";

// Resolves to build/api/ at runtime. This module compiles to
// build/codeapi/boot.js, so "../api" from there lands at build/api/.
// If anyone ever runs the server through `tsx src/codeapi/boot.ts`
// directly, the path would resolve to src/api/ which doesn't exist —
// but the repo has no tsx dev script today; npm run dev is `tsc
// --watch` which keeps build/api/ populated.
export function defaultApiDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "api");
}

export interface BootedCodeApi {
  bridge: BridgeServer;
  ctx: CodeApiToolContext;
}

export interface BootCodeApiOpts {
  client: JiraClient;
  // Forwarded to startBridge so JIRA_DISABLED_ACTIONS rules apply to
  // bridge dispatch. Without this, an op disabled in classic mode
  // would still be reachable when a user opts into code-api.
  disabledActions?: readonly string[];
  // Override hook for tests. Production callers leave this unset.
  apiDir?: string;
  // When false (default true) skip the cleanup-stale-sessions sweep.
  // Tests turn this off to avoid touching siblings of their session
  // dir.
  cleanupSessions?: boolean;
}

export async function bootCodeApi(
  opts: BootCodeApiOpts,
): Promise<BootedCodeApi> {
  if (opts.cleanupSessions !== false) {
    await cleanupStaleSessions().catch(() => {
      // Best-effort. Permission failures on a stale dir shouldn't
      // block startup.
    });
  }

  const apiDir = opts.apiDir ?? defaultApiDir();

  const bridge = await startBridge({
    manifest: operations,
    client: opts.client,
    disabledActions: opts.disabledActions,
  });

  // Place the socket in the *server* env so any subprocess (Claude
  // Code's Bash tool, a tsx invocation) inherits it without the
  // user having to configure anything.
  process.env.JIRA_MCP_SOCKET = bridge.address;

  return {
    bridge,
    ctx: { apiDir, socketAddress: bridge.address },
  };
}
