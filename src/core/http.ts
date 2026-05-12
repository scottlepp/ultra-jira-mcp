// Re-export of the toolkit's retry-aware HTTP transport.
//
// The retry logic (429 honoring Retry-After), the undici Agent pool,
// the test transport hook, and the graceful-shutdown pool close — all
// generic. Lifted into `@scottlepp/mcp-toolkit/transport` so
// confluence-mcp and any future MCP server inherit the same behavior.
export {
  httpRequest,
  closeHttpPool,
  computeBackoffMs,
  DEFAULT_RETRY,
  __setTransportForTests,
  type HttpRequestInit,
  type HttpResponse,
  type TransportFn,
  type RetryOptions,
} from "@scottlepp/mcp-toolkit/transport";
