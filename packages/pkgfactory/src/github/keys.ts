import { base64, unbase64url, utf8 } from '../core/encoding.js';
import { cryptoBoxSeal } from '@serenity-kit/noble-sodium';
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0)); let i = 0;
  for (const b of parts) {out.set(b, i); i += b.length;} return out;
};
const uint32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const field = (b: Uint8Array) => concat(uint32(b.length), b);
const pem = (type: string, b: Uint8Array) => `-----BEGIN ${type} PRIVATE KEY-----\n${base64(b).match(/.{1,70}/g)!.join('\n')}\n-----END ${type} PRIVATE KEY-----\n`;
export type KeyAlgorithm = 'ed25519' | 'rsa4096';
export interface DeployKey {publicKey: string; secret: string; algorithm: KeyAlgorithm}
export async function generateDeployKey(algorithm: KeyAlgorithm = 'ed25519'): Promise<DeployKey> {
  if (algorithm === 'ed25519') {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = unbase64url(jwk.x!); const seed = unbase64url(jwk.d!);
    const publicBlob = concat(field(utf8('ssh-ed25519')), field(pub));
    const check = crypto.getRandomValues(new Uint8Array(4));
    let privateBlob = concat(check, check, field(utf8('ssh-ed25519')), field(pub), field(concat(seed, pub)), field(utf8('PkgFactory')));
    const padding = 8 - privateBlob.length % 8;
    privateBlob = concat(privateBlob, Uint8Array.from({length: padding}, (_, i) => i + 1));
    const wire = concat(utf8('openssh-key-v1\0'), field(utf8('none')), field(utf8('none')), field(new Uint8Array()), uint32(1), field(publicBlob), field(privateBlob));
    return {algorithm, publicKey: `ssh-ed25519 ${base64(publicBlob)} PkgFactory`, secret: base64(utf8(pem('OPENSSH', wire)))};
  }
  const pair = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const mpint = (s: string) => {const b = unbase64url(s); return b[0] & 128 ? concat(new Uint8Array([0]), b) : b;};
  const derLength = (n: number): Uint8Array => n < 128 ? new Uint8Array([n]) : n < 256 ? new Uint8Array([129, n]) : new Uint8Array([130, n >> 8, n & 255]);
  const integer = (s: string) => {const b = mpint(s); return concat(new Uint8Array([2]), derLength(b.length), b);};
  const inner = concat(new Uint8Array([2, 1, 0]), ...[jwk.n!, jwk.e!, jwk.d!, jwk.p!, jwk.q!, jwk.dp!, jwk.dq!, jwk.qi!].map(integer));
  const privateBlob = concat(new Uint8Array([48]), derLength(inner.length), inner);
  const publicBlob = concat(field(utf8('ssh-rsa')), field(mpint(jwk.e!)), field(mpint(jwk.n!)));
  return {algorithm, publicKey: `ssh-rsa ${base64(publicBlob)} PkgFactory`, secret: base64(utf8(pem('RSA', privateBlob)))};
}
export function sealSecret(secret: string, publicKey: Uint8Array): string {
  return base64(cryptoBoxSeal({message: utf8(secret), publicKey}));
}
