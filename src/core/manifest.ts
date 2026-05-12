// Jira-specific manifest helpers.
//
// All generic manifest plumbing (Operation type, splitArgs,
// interpolatePath, findOperation, query-param coercion, rawString body
// handling, executor hook) lives in `@scottlepp/mcp-toolkit/manifest`.
// This module:
//
//   1. Extends `Operation` with `isAgile?: boolean` so existing entries
//      in `operations.ts` keep their top-level `isAgile: true` field.
//   2. Routes calls to `client.agileGet/Post/Put/Delete` when the op is
//      marked agile, falling back to platform `get/post/put/delete`.
//   3. Bakes the Jira trim registry into the high-level
//      `invokeOperation` so consumers don't pass it on every call.
//
// Layer 2 (consolidated classic tools) calls `invokeOperation`.
// Layer 3 (bridge handler) calls `invokeOperationRaw` so it can
// sandbox the full response and only apply the trim to the summary.

import {
  type ExecuteFn,
  type Operation as ToolkitOperation,
  invokeOperation as toolkitInvokeOperation,
  invokeOperationRaw as toolkitInvokeOperationRaw,
} from "@scottlepp/mcp-toolkit/manifest";

import type { JiraClient } from "../auth/jira-client.js";
import { trimRegistry, type TrimKey } from "./trim-registry.js";

// --- Re-exports -------------------------------------------------------

export {
  OperationError,
  extractPathParams,
  interpolatePath,
  splitArgs,
  findOperation,
  defaultExecute,
} from "@scottlepp/mcp-toolkit/manifest";

import { OperationError } from "@scottlepp/mcp-toolkit/manifest";

// Override the toolkit's generic "Operation X is disabled." message
// with one that names the env var the user needs to edit. The bridge
// dispatcher calls this directly, and integration tests assert on the
// JIRA_DISABLED_ACTIONS hint to confirm the right knob is documented.
export function assertOperationEnabled(
  name: string,
  disabledActions: readonly string[] | undefined,
): void {
  if (!disabledActions || disabledActions.length === 0) return;
  if (disabledActions.includes(name)) {
    throw new OperationError(
      `Operation ${name} is disabled by JIRA_DISABLED_ACTIONS.`,
      name,
    );
  }
}

export type {
  HttpVerb,
  ParamRole,
  ParamSpec,
  BodyShape,
  SplitArgs,
  ExecuteContext,
  ExecuteFn,
  InvokeOptions,
} from "@scottlepp/mcp-toolkit/manifest";

// --- Jira extensions --------------------------------------------------

// `isAgile` lives at the top level (rather than under `meta`) because
// the existing operations.ts declares hundreds of entries with
// `isAgile: true`. Moving it under `meta` would be churn for no benefit.
// `trim` is narrowed to the typed TrimKey so the registry lookup is
// type-safe at the call site.
export interface Operation extends Omit<ToolkitOperation, "trim"> {
  isAgile?: boolean;
  trim?: TrimKey;
}

export type Manifest = readonly Operation[];

// Routes a fully-resolved operation call to the right JiraClient method.
// Inspects `op.isAgile` to pick between `client.agile*` and `client.*`.
// Exported so the bridge can compose it with `assertOperationEnabled`
// to surface the JIRA_DISABLED_ACTIONS-aware message before any HTTP
// call.
export const executeJiraOp: ExecuteFn = async (ctx) => {
  const op = ctx.op as Operation;
  const client = ctx.client as JiraClient;
  const { path, queryParams, body } = ctx;

  if (op.isAgile) {
    switch (op.verb) {
      case "GET":
        return client.agileGet(path, queryParams);
      case "POST":
        return client.agilePost(path, body, queryParams);
      case "PUT":
        return client.agilePut(path, body, queryParams);
      case "DELETE":
        return client.agileDelete(path, queryParams);
    }
  }
  switch (op.verb) {
    case "GET":
      return client.get(path, queryParams);
    case "POST":
      return client.post(path, body, queryParams);
    case "PUT":
      return client.put(path, body, queryParams);
    case "DELETE":
      return client.delete(path, queryParams);
  }
};

// --- Dispatcher wrappers ----------------------------------------------

export async function invokeOperationRaw(
  manifest: Manifest,
  client: JiraClient,
  name: string,
  args: Record<string, unknown>,
  disabledActions?: readonly string[],
): Promise<{ op: Operation; response: unknown }> {
  // Check disabled actions ourselves so the OperationError message
  // names JIRA_DISABLED_ACTIONS. The toolkit's internal check (which
  // would throw a generic message) becomes a no-op once we've
  // filtered out disabled ops here.
  assertOperationEnabled(name, disabledActions);
  const result = await toolkitInvokeOperationRaw(
    manifest,
    client,
    name,
    args,
    { execute: executeJiraOp },
  );
  return { op: result.op as Operation, response: result.response };
}

export async function invokeOperation(
  manifest: Manifest,
  client: JiraClient,
  name: string,
  args: Record<string, unknown>,
  disabledActions?: readonly string[],
): Promise<unknown> {
  assertOperationEnabled(name, disabledActions);
  return toolkitInvokeOperation(manifest, client, name, args, trimRegistry, {
    execute: executeJiraOp,
  });
}
