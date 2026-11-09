import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Factory, Credentials } from '../application/factory.js';
import { mcpServer } from '../mcp/server.js';
/** pkgfactory mcp --stdio: serve the MCP tools over this process's stdio until the client or a signal ends it. */
export async function stdioMcp(factory: Factory, credentials: () => Credentials | undefined, controller: AbortController, readOnly?: boolean) {
  const server = mcpServer(factory, credentials, controller.signal, readOnly);
  process.stdin.once('end', () => {controller.abort(); void server.close();});
  controller.signal.addEventListener('abort', () => {void server.close();}, {once: true});
  await server.connect(new StdioServerTransport());
}
