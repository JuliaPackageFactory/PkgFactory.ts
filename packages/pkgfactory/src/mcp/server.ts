import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { specSchema, listTemplates } from '../core/spec.js';
import { planReferenceSchema, restorePlan } from '../core/plan.js';
import { Factory, FactoryError, type Credentials } from '../application/engine.js';
export function mcpServer(factory: Factory, credentials: () => Credentials | undefined, parentSignal: AbortSignal, readOnly = false) {
  const server = new McpServer({name: 'PkgFactory', version: '0.1.0'});
  const content = (data: unknown) => ({content: [{type: 'text' as const, text: JSON.stringify(data)}]});
  const authenticated = () => {const c = credentials(); if (!c?.token) throw new FactoryError('auth', 'GitHub credentials are required for this operation.', 401); return c;};
  const run = async (action: () => Promise<unknown>) => {
    try {return content(await action());} catch (e) {return {...content({error: e instanceof FactoryError ? e.message : 'Operation failed.'}), isError: true};}
  };
  server.registerTool('list_templates', {description: 'List Julia package templates', inputSchema: {}, annotations: {readOnlyHint: true}}, () => content(listTemplates()));
  server.registerTool('preview_package', {description: 'Generate a preview of every file. Check owner access when authenticated. No GitHub writes. Nothing is stored: keep the returned plan id, uuid and createdAt for create_package.', inputSchema: specSchema.shape, annotations: {readOnlyHint: true}}, (input, extra) => run(() => {
    const c = credentials();
    return c ? factory.previewForAccount(input, c, AbortSignal.any([parentSignal, extra.signal])) : factory.preview(input);
  }));
  if (!readOnly) {
    server.registerTool('create_package', {description: 'Create the repository from a reviewed preview. Pass the same settings plus the preview\'s plan {id, uuid, createdAt} so the files match the preview exactly. Ask the user to approve the preview before calling. A failure names the step that stopped and leaves the repository on GitHub for manual inspection or deletion; there is no automatic resume.', inputSchema: {...specSchema.shape, plan: planReferenceSchema, confirm: z.literal(true)}, annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false}}, (input, extra) => run(async () => {
      const {plan, confirm: _confirm, ...spec} = input;
      return factory.execute(await restorePlan(spec, plan), authenticated(), AbortSignal.any([parentSignal, extra.signal]));
    }));
  }
  return server;
}
export async function mcpHttp(request: Request, factory: Factory, c: Credentials) {
  const server = mcpServer(factory, () => c, request.signal);
  const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
  await server.connect(transport);
  try {return await transport.handleRequest(request);} finally {await server.close();}
}
