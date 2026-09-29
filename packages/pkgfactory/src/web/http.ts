import { FactoryError } from '../application/engine.js';
import { GitHubError } from '../github/client.js';
import { ZodError } from 'zod';
export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
export async function readJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new FactoryError('content-type', 'JSON required', 415);
  return JSON.parse(await limitedBody(request, 131072));
}
export async function limitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader(); if (!reader) return '';
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {const {done, value} = await reader.read(); if (done) break; size += value.length;
    if (size > limit) {await reader.cancel(); throw new FactoryError('size', 'Request too large', 413);} chunks.push(value);}
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  return new TextDecoder().decode(bytes);
}
export function errorResponse(error: unknown) {
  if (error instanceof FactoryError) return json({error: error.message, code: error.code}, error.status);
  if (error instanceof GitHubError) return json({error: `${error.message} Check status before explicit resume.`, ...(error.status === 401 ? {code: 'auth'} : {})}, error.status === 401 ? 401 : 502);
  if (error instanceof ZodError) return json({error: error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')}, 400);
  if (error instanceof SyntaxError) return json({error: 'Invalid request input'}, 400);
  return json({error: 'Operation stopped. Inspect status before explicitly resuming.'}, 502);
}
