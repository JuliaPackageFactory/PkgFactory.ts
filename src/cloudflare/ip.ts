// URL parsing validates and canonicalizes compressed/expanded/mapped IPv6 in
// both Node and workerd, without relying on Node-specific networking APIs.
export function ipv6Words(address: string): number[] | undefined {
  const raw = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  if (!raw.includes(':') || !/^[\da-f:.]+$/i.test(raw)) return;
  try {
    const host = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
    const [left, right] = host.split('::');
    const start = left ? left.split(':').map(n => parseInt(n, 16)) : [];
    const end = right ? right.split(':').map(n => parseInt(n, 16)) : [];
    return right === undefined ? start : [...start, ...Array(8 - start.length - end.length).fill(0), ...end];
  } catch {return;}
}
export function ipv4Address(address: string): string | undefined {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
    const bytes = address.split('.').map(Number);
    if (bytes.every(n => n <= 255)) return bytes.join('.');
  }
  const words = ipv6Words(address);
  if (words?.slice(0, 5).every(n => n === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
  }
}
export function loginSource(address: string | null): string {
  const v4 = ipv4Address(address ?? '');
  if (v4) return `ipv4:${v4}`;
  const words = ipv6Words(address ?? '');
  return words ? `ipv6:${words.slice(0, 4).map(n => n.toString(16)).join(':')}::/64` : 'unknown';
}
