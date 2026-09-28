export const utf8 = (s: string) => new TextEncoder().encode(s);
export const decode = (b: Uint8Array) => new TextDecoder().decode(b);
export function base64(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
}
export const unbase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const base64url = (b: Uint8Array) => base64(b).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export const unbase64url = (s: string) => unbase64(s.replaceAll('-', '+').replaceAll('_', '/'));
export async function sha256(s: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s))), b => b.toString(16).padStart(2, '0')).join('');
}
export const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
