import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { JiraClient } from "../../../src/auth/jira-client.js";
import type { Manifest } from "../../../src/core/manifest.js";
import {
  buildInputSchema,
  dispatchTool,
  ToolError,
  type ConsolidatedTool,
} from "../../../src/tools/v2/dispatcher.js";

// --- Mock infra --------------------------------------------------------

function makeMockClient() {
  const calls: Array<{ api: string; path: string; query?: unknown; body?: unknown }> = [];
  let ret: unknown = {};
  const record = (api: string) =>
    vi.fn((path: string, bodyOrQuery?: unknown, maybeQuery?: unknown) => {
      if (api === "get" || api === "delete" || api === "agileGet" || api === "agileDelete") {
        calls.push({ api, path, query: bodyOrQuery });
      } else {
        calls.push({ api, path, body: bodyOrQuery, query: maybeQuery });
      }
      return Promise.resolve(ret);
    });
  const client = {
    get: record("get"),
    post: record("post"),
    put: record("put"),
    delete: record("delete"),
    agileGet: record("agileGet"),
    agilePost: record("agilePost"),
    agilePut: record("agilePut"),
    agileDelete: record("agileDelete"),
  } as unknown as JiraClient;
  return { client, calls, setReturn: (v: unknown) => { ret = v; } };
}

const fixtureManifest: Manifest = [
  {
    name: "fx.get",
    description: "",
    verb: "GET",
    pathTemplate: "/x/{id}",
    params: [
      { name: "id", role: "path", required: true },
      { name: "expand", role: "query" },
    ],
  },
  {
    name: "fx.create",
    description: "",
    verb: "POST",
    pathTemplate: "/x",
    params: [{ name: "name", role: "body", required: true }],
  },
];

const fixtureTool: ConsolidatedTool = {
  name: "jira_fx",
  description: "",
  actions: {
    get: {
      description: "Get one",
      schema: z.object({
        id: z.string(),
        expand: z.string().optional(),
      }),
      operation: "fx.get",
    },
    create: {
      description: "Create one",
      schema: z.object({
        name: z.string(),
      }),
      operation: "fx.create",
    },
  },
};

// --- dispatch tests ---------------------------------------------------

describe("dispatchTool", () => {
  it("rejects when action is missing", async () => {
    const { client } = makeMockClient();
    await expect(dispatchTool(fixtureTool, fixtureManifest, client, {})).rejects.toBeInstanceOf(ToolError);
    await expect(dispatchTool(fixtureTool, fixtureManifest, client, {})).rejects.toThrow(/requires.*action/);
  });

  it("rejects unknown actions with the list of known ones", async () => {
    const { client } = makeMockClient();
    await expect(
      dispatchTool(fixtureTool, fixtureManifest, client, { action: "nope" }),
    ).rejects.toThrow(/Unknown action.*Known: get, create/);
  });

  it("rejects when args fail Zod validation", async () => {
    const { client } = makeMockClient();
    await expect(
      // missing required `id`
      dispatchTool(fixtureTool, fixtureManifest, client, { action: "get" }),
    ).rejects.toThrow(/Invalid args.*jira_fx\.get/);
  });

  it("strips `action` before passing args to invokeOperation", async () => {
    const ctx = makeMockClient();
    await dispatchTool(fixtureTool, fixtureManifest, ctx.client, {
      action: "get",
      id: "42",
      expand: "transitions",
    });
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/x/42",
      query: { expand: "transitions" },
    });
  });

  it("dispatches POST + body for write actions", async () => {
    const ctx = makeMockClient();
    await dispatchTool(fixtureTool, fixtureManifest, ctx.client, {
      action: "create",
      name: "thing",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/x",
      body: { name: "thing" },
    });
  });

  it("wraps OperationError as ToolError so callers see a tool-shaped failure", async () => {
    const ctx = makeMockClient();
    // Operation that doesn't exist — invokeOperation throws OperationError.
    const badTool: ConsolidatedTool = {
      name: "jira_bad",
      description: "",
      actions: {
        go: {
          description: "",
          schema: z.object({}),
          operation: "missing.op",
        },
      },
    };
    const err = await dispatchTool(badTool, fixtureManifest, ctx.client, { action: "go" }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).action).toBe("go");
    expect((err as ToolError).tool).toBe("jira_bad");
  });
});

// --- buildInputSchema tests -------------------------------------------

describe("buildInputSchema", () => {
  it("emits a flat object schema with action as a string enum", () => {
    // Top-level oneOf/allOf/anyOf is rejected by the Anthropic
    // tool-use API. The schema must stay flat; per-action arg
    // validation happens in dispatchTool against the Zod schema.
    const schema = buildInputSchema(fixtureTool) as {
      type: string;
      properties: {
        action: { type: string; enum: string[] };
        [key: string]: unknown;
      };
      required: string[];
      additionalProperties: boolean;
      oneOf?: unknown;
      allOf?: unknown;
      anyOf?: unknown;
    };
    expect(schema.type).toBe("object");
    expect(schema.oneOf).toBeUndefined();
    expect(schema.allOf).toBeUndefined();
    expect(schema.anyOf).toBeUndefined();
    expect(schema.properties.action.type).toBe("string");
    expect(schema.properties.action.enum.sort()).toEqual(["create", "get"]);
    expect(schema.required).toEqual(["action"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("merges fields from all actions into a single property bag", () => {
    const schema = buildInputSchema(fixtureTool) as {
      properties: Record<string, unknown>;
    };
    // `id` is from get, `name` is from create — both must be present
    // so the agent can construct a valid call for either action.
    expect(schema.properties.id).toBeDefined();
    expect(schema.properties.name).toBeDefined();
    expect(schema.properties.expand).toBeDefined();
  });

  it("surfaces per-action required/optional fields in the description", () => {
    // Since the JSON Schema can't encode "required only when
    // action=X", the description has to carry that signal so the
    // agent doesn't have to guess.
    const schema = buildInputSchema(fixtureTool) as { description: string };
    expect(schema.description).toContain("get:");
    expect(schema.description).toContain("Get one");
    expect(schema.description).toContain("requires id");
    expect(schema.description).toContain("optional expand");
    expect(schema.description).toContain("create:");
    expect(schema.description).toContain("requires name");
  });

  it("emits oneOf for ZodUnion fields so agents see the variant types", () => {
    // Regression test for PR #174 review: previously ZodUnion fell
    // through to the default branch and produced { description } only,
    // leaving the wire shape unconstrained. oneOf nested under a
    // property is fine — only top-level oneOf is rejected.
    const tool: ConsolidatedTool = {
      name: "jira_u",
      description: "",
      actions: {
        do: {
          description: "",
          schema: z.object({
            picky: z
              .union([z.string(), z.array(z.string()), z.number()])
              .describe("string, array of strings, or number"),
          }),
          operation: "fx.get",
        },
      },
    };
    const schema = buildInputSchema(tool) as {
      properties: Record<string, unknown>;
    };
    const picky = schema.properties.picky as {
      oneOf?: Array<{ type?: string; items?: { type?: string } }>;
      description?: string;
    };
    expect(picky?.description).toBe("string, array of strings, or number");
    expect(picky?.oneOf).toHaveLength(3);
    expect(picky?.oneOf?.[0]).toEqual({ type: "string" });
    expect(picky?.oneOf?.[1]).toEqual({
      type: "array",
      items: { type: "string" },
    });
    expect(picky?.oneOf?.[2]).toEqual({ type: "number" });
  });
});
