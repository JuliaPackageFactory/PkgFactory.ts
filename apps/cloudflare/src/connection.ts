import { errorResponse } from '../../../packages/pkgfactory/src/web/http.js';
/** Open the response before executing writes. workerd detects response-stream
 * cancellation even where a disconnect during a buffered fetch isn't delivered.
 * JSON permits leading whitespace. There is no detached job or waitUntil here. */
export function connectedJson(request: Request, action: (signal: AbortSignal, checkConnection: () => Promise<void>) => Promise<Response>): Response {
  const disconnected = new AbortController();
  const signal = AbortSignal.any([request.signal, disconnected.signal]);
  const encoder = new TextEncoder();
  const {readable, writable} = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  void writer.closed.catch(() => disconnected.abort());
  const checkConnection = async () => {
    signal.throwIfAborted();
    try {await writer.write(encoder.encode(' '));} catch {disconnected.abort();}
    signal.throwIfAborted();
  };
  let interval: ReturnType<typeof setInterval> | undefined;
  void (async () => {
    try {
      await writer.write(encoder.encode('\n'));
      signal.throwIfAborted();
      // Keep the socket active while an upstream operation is in flight: local
      // workerd can deliver disconnect only after a response write fails.
      interval = setInterval(() => {void checkConnection().catch(() => disconnected.abort());}, 50);
      let response: Response;
      try {response = await action(signal, checkConnection);} catch (error) {response = errorResponse(error);}
      signal.throwIfAborted();
      await writer.write(encoder.encode(await response.text())); await writer.close();
    } catch {disconnected.abort(); await writer.abort().catch(() => {});}
    finally {clearInterval(interval);}
  })();
  return new Response(readable, {headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff'}});
}
