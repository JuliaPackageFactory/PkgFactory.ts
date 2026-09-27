import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deviceLogin } from '../github/device.js';
export async function tokenFor(options: {gh?: boolean; device?: boolean; clientId?: string}, signal: AbortSignal): Promise<string | undefined> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) return token.trim();
  if (options.gh) {
    try {return (await promisify(execFile)('gh', ['auth', 'token', '--hostname', 'github.com'], {signal, timeout: 10000})).stdout.trim();}
    catch {throw new Error('gh authentication unavailable. Run gh auth login or set GITHUB_TOKEN.');}
  }
  if (options.device) {
    const clientId = options.clientId || process.env.PKGFACTORY_GITHUB_CLIENT_ID;
    if (!clientId) throw new Error('Device Flow requires PKGFACTORY_GITHUB_CLIENT_ID from an OAuth app with Device Flow enabled.');
    return deviceLogin(clientId, (url, code) => console.error(`Open ${url} and enter ${code}`), signal);
  }
}
