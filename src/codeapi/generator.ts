// Code-API generator (Layer 3, PR #8).
//
// Walks the manifest and emits one TypeScript stub per operation
// under `${outDir}/api/`. Output is deterministic: same manifest +
// same outDir = byte-identical files. That property lets us
// golden-snapshot the result in tests and lets the runtime skip
// regeneration when the manifest hasn't changed.
//
// PR #9 will plug a real IPC bridge into the emitted `_client.ts`.
// PR #10 will call `generateApi()` from the MCP server's startup
// path, pointing outDir at the session cache directory.

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import type { Manifest, Operation } from "../core/manifest.js";
import {
  renderCategoryIndex,
  renderClientFile,
  renderRootIndex,
  renderStub,
  renderTypesFile,
  splitOperationName,
  type RenderedStub,
} from "./templates.js";

export interface GenerateApiOptions {
  manifest: Manifest;
  // Directory to emit into. Created (recursively) if absent. Existing
  // files are overwritten; stale files from a previous run are NOT
  // pruned (deferred to PR #10 where we own the lifecycle).
  outDir: string;
  // Module specifier the generated `types.ts` imports `Ref` from.
  // Resolution happens in the agent's execution context, so the
  // caller passes a value that makes sense there: typically an
  // absolute path into the installed `jira-mcp` package's build
  // directory, or a bare specifier if jira-mcp is a peer dep.
  refsImportPath?: string;
}

export interface GeneratedFile {
  // Absolute path of the file written.
  path: string;
  // Bytes written. Useful for the runtime to log / sanity-check.
  size: number;
}

export interface GenerateApiResult {
  outDir: string;
  files: GeneratedFile[];
  operationCount: number;
  categories: string[];
}

// Default refs import. Points at the build output relative to the
// installed jira-mcp package. `jira-mcp/build/types/refs.js` is the
// stable pin; the file already exists in the repo.
const DEFAULT_REFS_IMPORT = "jira-mcp/build/types/refs.js";

// Group operations by their category prefix. Returns a Map so iteration
// order is stable (insertion-ordered by first occurrence in the manifest).
function groupByCategory(manifest: Manifest): Map<string, Operation[]> {
  const groups = new Map<string, Operation[]>();
  for (const op of manifest) {
    const { category } = splitOperationName(op.name);
    const existing = groups.get(category);
    if (existing) {
      existing.push(op);
    } else {
      groups.set(category, [op]);
    }
  }
  return groups;
}

// Pure planning step: compute every file we'd write, without touching
// disk. The runtime calls this to compare against an existing tree;
// tests use it to assert structure.
export interface PlannedFile {
  relativePath: string;
  contents: string;
}

export function planApi(
  manifest: Manifest,
  refsImportPath: string = DEFAULT_REFS_IMPORT,
): PlannedFile[] {
  const groups = groupByCategory(manifest);
  const out: PlannedFile[] = [];

  // Static support files first so they appear at the top of any
  // sorted listing — easier on humans browsing the directory.
  out.push({ relativePath: "_client.ts", contents: renderClientFile() });
  out.push({
    relativePath: "types.ts",
    contents: renderTypesFile(refsImportPath),
  });
  out.push({
    relativePath: "index.ts",
    contents: renderRootIndex([...groups.keys()]),
  });

  for (const [category, ops] of groups) {
    out.push({
      relativePath: `${category}/index.ts`,
      contents: renderCategoryIndex(category, ops),
    });
    for (const op of ops) {
      const stub: RenderedStub = renderStub(op);
      out.push({
        relativePath: stub.relativePath,
        contents: stub.contents,
      });
    }
  }

  // Sort the result so the planning output is order-stable regardless
  // of category insertion order. Keeps golden snapshots small and
  // diffable.
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

export async function generateApi(
  opts: GenerateApiOptions,
): Promise<GenerateApiResult> {
  const refsImportPath = opts.refsImportPath ?? DEFAULT_REFS_IMPORT;
  const planned = planApi(opts.manifest, refsImportPath);

  const written: GeneratedFile[] = [];
  // Create directories breadth-first so we don't redundantly mkdir for
  // every stub in a category. Tracking via a Set keeps it cheap.
  const ensuredDirs = new Set<string>();
  ensuredDirs.add(opts.outDir);
  await fsp.mkdir(opts.outDir, { recursive: true });

  for (const file of planned) {
    const abs = path.join(opts.outDir, file.relativePath);
    const dir = path.dirname(abs);
    if (!ensuredDirs.has(dir)) {
      await fsp.mkdir(dir, { recursive: true });
      ensuredDirs.add(dir);
    }
    await fsp.writeFile(abs, file.contents, "utf8");
    written.push({ path: abs, size: Buffer.byteLength(file.contents, "utf8") });
  }

  const categories = [...groupByCategory(opts.manifest).keys()].sort();

  return {
    outDir: opts.outDir,
    files: written,
    operationCount: opts.manifest.length,
    categories,
  };
}
