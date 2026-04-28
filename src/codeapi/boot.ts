// Code-api startup glue (PR #10).
//
// Pulled out of `src/index.ts` so the wiring (cleanup → generate
// stubs → start bridge → publish socket env var) is testable in
// isolation, without standing up the MCP transport.

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { JiraClient } from "../auth/jira-client.js";
import { operations } from "../core/operations.js";
import { cleanupStaleSessions, sessionCacheDir } from "../core/sandbox.js";
import { startBridge, type BridgeServer } from "./bridge.js";
import { generateApi } from "./generator.js";
import type { CodeApiToolContext } from "./tool.js";

// Where the generator points stubs' `types.ts` to find Ref<T>.
// Stubs live in the session cache dir, far from the installed
// jira-mcp package, so we use the absolute path of this build's
// compiled refs.js. Resolved relative to *this* module so it stays
// correct under `npm link`, npm install, or running from `build/`.
export function defaultRefsImportPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/codeapi/boot.ts → src/types/refs.ts (after compile:
  // build/codeapi/boot.js → build/types/refs.js).
  return path.join(here, "..", "types", "refs.js");
}

export interface BootedCodeApi {
  bridge: BridgeServer;
  ctx: CodeApiToolContext;
}

export interface BootCodeApiOpts {
  client: JiraClient;
  // Override hooks for tests. Production callers leave these unset.
  refsImportPath?: string;
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

  const apiDir = opts.apiDir ?? path.join(sessionCacheDir(), "api");
  await generateApi({
    manifest: operations,
    outDir: apiDir,
    refsImportPath: opts.refsImportPath ?? defaultRefsImportPath(),
  });

  const bridge = await startBridge({
    manifest: operations,
    client: opts.client,
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
