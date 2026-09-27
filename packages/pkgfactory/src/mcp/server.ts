import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { specSchema, listTemplates } from '../core/spec.js';
import { Factory, FactoryError, type Credentials } from '../application/engine.js';
export function mcpServer(factory: Factory, subject: string, credentials: () => Credentials, parentSignal: AbortSignal, readOnly = false) {
  const server = new McpServer({name: 'PkgFactory', version: '0.1.0'});
  const content = (data: unknown) => ({content: [{type: 'text' as const, text: JSON.stringify(data)}]});
  const run = async (action: () => Promise<unknown>) => {
    try {return content(await action());} catch (e) {return {...content({error: e instanceof FactoryError ? e.message : 'Operation failed. Inspect repository_status before explicitly resuming.'}), isError: true};}
  };
  server.registerTool('list_templates', {description: 'List Julia package templates', inputSchema: {}, annotations: {readOnlyHint: true}}, () => content(listTemplates()));
  server.registerTool('preview_package', {description: 'Generate and save an immutable preview. No GitHub writes.', inputSchema: specSchema.shape, annotations: {readOnlyHint: true}}, input => run(() => factory.preview(input, subject)));
  server.registerTool('repository_status', {description: 'Inspect saved operation and GitHub state before resume', inputSchema: {planId: z.string().uuid()}, annotations: {readOnlyHint: true}}, (input, extra) => run(() => factory.status(input.planId, credentials(), AbortSignal.any([parentSignal, extra.signal]))));
  if (!readOnly) {
    server.registerTool('create_package', {description: 'Create the repository from the reviewed preview. Ask the user to approve the saved plan before calling.', inputSchema: {planId: z.string().uuid(), confirm: z.literal(true)}, annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false}}, (input, extra) => run(() => factory.execute(input.planId, credentials(), false, AbortSignal.any([parentSignal, extra.signal]))));
    server.registerTool('resume_package', {description: 'Explicitly reconcile and resume a stopped operation after reviewing repository_status.', inputSchema: {planId: z.string().uuid(), confirm: z.literal(true)}, annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false}}, (input, extra) => run(() => factory.execute(input.planId, credentials(), true, AbortSignal.any([parentSignal, extra.signal]))));
  }
  return server;
}
export async function mcpHttp(request: Request, factory: Factory, c: Credentials) {
  const server = mcpServer(factory, c.subject, () => c, request.signal);
  const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
  await server.connect(transport);
  try {return await transport.handleRequest(request);} finally {await server.close();}
}
