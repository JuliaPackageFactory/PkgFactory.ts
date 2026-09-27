import { generateDeployKey, sealSecret } from '../../packages/pkgfactory/src/github/keys.js';
import { planPackage } from '../../packages/pkgfactory/src/core/plan.js';
export default {async fetch(request: Request) {
  const data = await request.json() as any;
  if (data.key) {const start = performance.now(); const key = await generateDeployKey(data.key); return Response.json({...key, ms: performance.now() - start});}
  if (data.seal) return Response.json({ciphertext: sealSecret(data.seal, new Uint8Array(data.publicKey))});
  return Response.json(await planPackage(data.spec, data.fixed));
}};
