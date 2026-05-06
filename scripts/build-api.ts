// Generates the static code-api directory at build time.
//
// Output lands at `build/api/`, alongside the rest of the compiled
// MCP server. This is what code-api mode hands to the agent — a
// pre-built, package-shipped TypeScript surface keyed off
// `JIRA_MCP_SOCKET` for per-session disambiguation.
//
// Earlier versions generated this per session at MCP-server startup
// because the generated `types.ts` embedded an install-specific
// absolute path. That dependency is gone (types are now inlined),
// so generation moves to build time and `build/api/` ships in the
// npm tarball.

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { generateApi } from "../src/codeapi/generator.js";
import { operations } from "../src/core/operations.js";

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, "..", "build", "api");

  const result = await generateApi({
    manifest: operations,
    outDir,
  });

  console.log(
    `[build-api] wrote ${result.files.length} files (${result.operationCount} operations across ${result.categories.length} categories) to ${outDir}`,
  );
}

void main().catch((err) => {
  console.error("[build-api] failed:", err);
  process.exit(1);
});
