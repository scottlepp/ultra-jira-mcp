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
  it("emits oneOf with one branch per action and a const action discriminator", () => {
    const schema = buildInputSchema(fixtureTool) as {
      type: string;
      oneOf: Array<{
        type: string;
        properties: { action: { const: string } };
        required: string[];
      }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.oneOf).toHaveLength(2);
    const titles = schema.oneOf.map((b) => (b as unknown as { title: string }).title).sort();
    expect(titles).toEqual(["create", "get"]);
    for (const branch of schema.oneOf) {
      expect(branch.properties.action.const).toMatch(/^(get|create)$/);
      expect(branch.required).toContain("action");
    }
  });

  it("marks optional Zod fields as not-required in the JSON schema", () => {
    const schema = buildInputSchema(fixtureTool) as {
      oneOf: Array<{ title?: string; required: string[] }>;
    };
    const getBranch = schema.oneOf.find((b) => b.title === "get");
    expect(getBranch?.required).toContain("id");
    expect(getBranch?.required).not.toContain("expand");
  });
});
