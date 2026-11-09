import { generateDeployKey } from '../src/github/keys.js';
for (const algorithm of ['ed25519', 'rsa4096'] as const) {
  const started = performance.now();
  const key = await generateDeployKey(algorithm);
  console.log(JSON.stringify({algorithm, ms: Math.round(performance.now() - started), publicBytes: key.publicKey.length, secretBytes: key.secret.length}));
}
