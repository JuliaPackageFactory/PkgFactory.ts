export async function deviceLogin(clientId: string, inform: (url: string, code: string) => void, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  const post = async (path: string, body: Record<string, string>) => {
    signal.throwIfAborted();
    const response = await fetcher(`https://github.com/login/${path}`, {method: 'POST', headers: {Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)])});
    if (!response.ok) throw new Error(`GitHub Device Flow failed (${response.status})`);
    return await response.json() as any;
  };
  const device = await post('device/code', {client_id: clientId, scope: 'repo workflow read:user read:org'});
  if (!device.device_code || !device.user_code || !Number.isFinite(device.expires_in)) throw new Error('GitHub did not return a device code');
  inform(device.verification_uri, device.user_code);
  const expires = Date.now() + device.expires_in * 1000;
  let interval = Math.max(device.interval ?? 5, 1) * 1000;
  while (Date.now() < expires) {
    await new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const done = () => {signal.removeEventListener('abort', abort); resolve();};
      const timer = setTimeout(done, interval);
      const abort = () => {clearTimeout(timer); reject(signal.reason);};
      signal.addEventListener('abort', abort, {once: true});
    });
    const result = await post('oauth/access_token', {client_id: clientId, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code'});
    if (typeof result.access_token === 'string') return result.access_token;
    if (result.error === 'slow_down') interval += 5000;
    else if (result.error !== 'authorization_pending') throw new Error('Device authorization denied or expired');
  }
  throw new Error('Device authorization expired');
}
