import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { generateDeployKey, sealSecret } from '../packages/pkgfactory/src/github/keys.js';
import { unbase64, decode } from '../packages/pkgfactory/src/core/encoding.js';
for (const algorithm of ['ed25519', 'rsa4096'] as const) test(`${algorithm}: OpenSSH reads generated private key`, async () => {
  const key = await generateDeployKey(algorithm);
  const dir = await mkdtemp(join(tmpdir(), 'pkgfactory-key-'));
  try {
    const path = join(dir, 'key'); await writeFile(path, unbase64(key.secret), {mode: 0o600});
    if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-Command', `$p = '${path.replaceAll("'", "''")}'; $acl = New-Object System.Security.AccessControl.FileSecurity; $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($identity); $acl.SetAccessRuleProtection($true, $false); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow'))); [System.IO.File]::SetAccessControl($p, $acl)`]);
    const pub = execFileSync('ssh-keygen', ['-y', '-f', path], {encoding: 'utf8'}).trim();
    assert.equal(pub.split(' ').slice(0, 2).join(' '), key.publicKey.split(' ').slice(0, 2).join(' '));
  } finally {await rm(dir, {recursive: true, force: true});}
});
test('sealed box interoperates with libsodium', async () => {
  // Independent implementation used by GitHub to open encrypted Actions secrets.
  const sodium = createRequire(import.meta.url)('libsodium-wrappers');
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  const encrypted = sealSecret('秘密\nDocumenter key', pair.publicKey);
  assert.equal(decode(sodium.crypto_box_seal_open(unbase64(encrypted), pair.publicKey, pair.privateKey)), '秘密\nDocumenter key');
});
