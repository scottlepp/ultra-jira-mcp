// Initial operation declarations.
//
// This PR (#6) lands a representative subset covering every shape the
// manifest / dispatcher / generator must handle:
//   - GET with path + query params                     (issue.get)
//   - GET returning a paginated collection             (comment.list)
//   - POST with JSON body                              (issue.create)
//   - POST with path + body (nested resource)          (comment.add)
//   - PUT with path + body                             (issue.update)
//   - DELETE with path                                 (issue.delete)
//   - JQL search (POST with body, not GET)             (search.issues)
//   - Agile API with path params                       (board.get)
//   - Agile API with path + paginated query            (sprint.listForBoard)
//   - Metadata GET (cached by JiraClient's LRU)        (field.list)
//
// PR #7 extends this to cover the full v1 surface (~85 operations)
// before the consolidated classic tools go live.

import type { Manifest } from "./manifest.js";

export const operations: Manifest = [
  // ------------------------------- Issue --------------------------------
  {
    name: "issue.get",
    description: "Fetch a single issue by key or id.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "fields", role: "query", description: "Comma-separated field list" },
      { name: "expand", role: "query", description: "Comma-separated expand list" },
    ],
    trim: "issue",
  },
  {
    name: "issue.create",
    description: "Create a new issue.",
    verb: "POST",
    pathTemplate: "/issue",
    params: [
      { name: "fields", role: "body", required: true },
      { name: "update", role: "body" },
      { name: "historyMetadata", role: "body" },
      { name: "properties", role: "body" },
      { name: "transition", role: "body" },
    ],
  },
  {
    name: "issue.update",
    description: "Update fields on an existing issue.",
    verb: "PUT",
    pathTemplate: "/issue/{issueIdOrKey}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "fields", role: "body" },
      { name: "update", role: "body" },
      { name: "notifyUsers", role: "query" },
    ],
  },
  {
    name: "issue.delete",
    description: "Delete an issue.",
    verb: "DELETE",
    pathTemplate: "/issue/{issueIdOrKey}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "deleteSubtasks", role: "query" },
    ],
  },

  // ------------------------------ Search --------------------------------
  {
    name: "search.issues",
    description: "Run a JQL search for issues. POST for long queries.",
    verb: "POST",
    pathTemplate: "/search",
    params: [
      { name: "jql", role: "body", required: true },
      { name: "fields", role: "body" },
      { name: "expand", role: "body" },
      { name: "startAt", role: "body" },
      { name: "maxResults", role: "body" },
    ],
    trim: "search",
  },

  // ------------------------------ Comment -------------------------------
  {
    name: "comment.list",
    description: "List comments on an issue.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}/comment",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "orderBy", role: "query" },
      { name: "expand", role: "query" },
    ],
  },
  {
    name: "comment.add",
    description: "Add a comment to an issue.",
    verb: "POST",
    pathTemplate: "/issue/{issueIdOrKey}/comment",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "body", role: "body", required: true },
      { name: "visibility", role: "body" },
    ],
    trim: "comment",
  },

  // ------------------------------ Metadata ------------------------------
  {
    name: "field.list",
    description: "List all fields available in this Jira instance.",
    verb: "GET",
    pathTemplate: "/field",
    params: [],
  },

  // ------------------------------- Agile --------------------------------
  {
    name: "board.get",
    description: "Fetch a single board by id.",
    verb: "GET",
    pathTemplate: "/board/{boardId}",
    isAgile: true,
    params: [{ name: "boardId", role: "path", required: true }],
  },
  {
    name: "sprint.listForBoard",
    description: "List sprints belonging to a board.",
    verb: "GET",
    pathTemplate: "/board/{boardId}/sprint",
    isAgile: true,
    params: [
      { name: "boardId", role: "path", required: true },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "state", role: "query", description: "future, active, closed" },
    ],
  },
];
