import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('AICRMBAK2\n', 'ascii');
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;
const FILE_PATTERN = /^ai-crm-\d{8}T\d{9}Z\.dump\.enc$/;

function encryptionKey(): { key: Buffer; keyId: string } {
  const encoded = process.env.BACKUP_ENCRYPTION_KEY?.trim() ?? '';
  const keyId = process.env.BACKUP_ENCRYPTION_KEY_ID?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) throw new Error('BACKUP_ENCRYPTION_KEY_ID is required and invalid');
  const key = /^[a-f0-9]{64}$/i.test(encoded) ? Buffer.from(encoded, 'hex') : Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes');
  if (encoded === process.env.FIELD_SEARCH_KEY || (process.env.ENCRYPTION_KEYS ?? '').includes(encoded)) {
    throw new Error('Backup encryption must use a dedicated key');
  }
  return { key, keyId };
}

function postgresEnvironment(value: string): NodeJS.ProcessEnv {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Backup database URL must use PostgreSQL');
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: url.pathname.replace(/^\//, ''),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') ?? (process.env.NODE_ENV === 'production' ? 'require' : 'prefer'),
  };
}

function databaseUrl(): string {
  const value = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!value) throw new Error('BACKUP_DATABASE_URL or DATABASE_URL is required');
  if (process.env.NODE_ENV === 'production' && !process.env.BACKUP_DATABASE_URL) {
    throw new Error('BACKUP_DATABASE_URL is required in production and must use the read-only backup role');
  }
  return value;
}

async function childCompleted(child: ReturnType<typeof spawn>, name: string) {
  const stderr: Buffer[] = [];
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.reduce((size, item) => size + item.length, 0) < 8_192) stderr.push(chunk);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`${name} failed with exit code ${code}: ${Buffer.concat(stderr).toString('utf8').slice(0, 2_000)}`);
}

async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function pruneBackups(directory: string, retentionDays: number) {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new Error('BACKUP_RETENTION_DAYS must be a positive integer');
  const cutoff = Date.now() - retentionDays * 86_400_000;
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !FILE_PATTERN.test(entry.name)) continue;
    const candidate = path.resolve(directory, entry.name);
    if (path.dirname(candidate) !== directory) continue;
    const stat = await fs.promises.stat(candidate);
    if (stat.mtimeMs < cutoff) {
      await fs.promises.rm(candidate);
      await fs.promises.rm(`${candidate}.json`, { force: true });
    }
  }
}

export async function createEncryptedBackup(): Promise<string> {
  const { key, keyId } = encryptionKey();
  const backupDirectory = path.resolve(process.env.BACKUP_DIR || 'backups');
  await fs.promises.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const output = path.resolve(backupDirectory, `ai-crm-${stamp}.dump.enc`);
  if (path.dirname(output) !== backupDirectory) throw new Error('Invalid backup output path');
  const temporary = `${output}.${crypto.randomUUID()}.tmp`;
  const iv = crypto.randomBytes(IV_BYTES);
  const metadata = { version: 2, algorithm: 'AES-256-GCM', keyId, iv: iv.toString('base64url'), createdAt: new Date().toISOString(), format: 'pg_dump-custom' };
  const header = Buffer.concat([MAGIC, Buffer.from(`${JSON.stringify(metadata)}\n`, 'utf8')]);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(header);
  const writer = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
  writer.write(header);
  const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
    env: postgresEnvironment(databaseUrl()),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  try {
    if (!child.stdout) throw new Error('pg_dump stdout is unavailable');
    await Promise.all([pipeline(child.stdout, cipher, writer), childCompleted(child, 'pg_dump')]);
    await fs.promises.appendFile(temporary, cipher.getAuthTag());
    await fs.promises.rename(temporary, output);
    const manifest = { ...metadata, file: path.basename(output), sha256: await sha256File(output) };
    await fs.promises.writeFile(`${output}.json`, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await pruneBackups(backupDirectory, Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '35', 10));
    return output;
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
}

async function encryptedFileParts(file: string, key: Buffer) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const prefix = Buffer.alloc(4_096);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    const content = prefix.subarray(0, bytesRead);
    if (!content.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Encrypted backup header is invalid');
    const end = content.indexOf(0x0a, MAGIC.length);
    if (end < 0) throw new Error('Encrypted backup metadata is invalid');
    const header = content.subarray(0, end + 1);
    const metadata = JSON.parse(content.subarray(MAGIC.length, end).toString('utf8')) as { iv?: string; keyId?: string };
    const configuredKeyId = process.env.BACKUP_ENCRYPTION_KEY_ID;
    if (metadata.keyId !== configuredKeyId) throw new Error(`Backup requires encryption key ${metadata.keyId ?? 'unknown'}`);
    const iv = Buffer.from(metadata.iv ?? '', 'base64url');
    if (iv.length !== IV_BYTES) throw new Error('Encrypted backup IV is invalid');
    const stat = await handle.stat();
    if (stat.size <= header.length + AUTH_TAG_BYTES) throw new Error('Encrypted backup is truncated');
    const tag = Buffer.alloc(AUTH_TAG_BYTES);
    await handle.read(tag, 0, tag.length, stat.size - tag.length);
    return { header, iv, tag, start: header.length, end: stat.size - tag.length - 1, key };
  } finally {
    await handle.close();
  }
}

function decryptStream(file: string, parts: Awaited<ReturnType<typeof encryptedFileParts>>) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', parts.key, parts.iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAAD(parts.header);
  decipher.setAuthTag(parts.tag);
  return { source: fs.createReadStream(file, { start: parts.start, end: parts.end }), decipher };
}

export async function restoreEncryptedBackup(fileName: string): Promise<void> {
  const file = path.resolve(fileName);
  const { key } = encryptionKey();
  const parts = await encryptedFileParts(file, key);
  const verification = decryptStream(file, parts);
  await pipeline(verification.source, verification.decipher, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));

  const child = spawn('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', process.env.PGDATABASE || new URL(databaseUrl()).pathname.replace(/^\//, '')], {
    env: postgresEnvironment(databaseUrl()),
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  });
  if (!child.stdin) throw new Error('pg_restore stdin is unavailable');
  const decrypted = decryptStream(file, parts);
  await Promise.all([pipeline(decrypted.source, decrypted.decipher, child.stdin), childCompleted(child, 'pg_restore')]);
}

async function main() {
  const [operation = 'backup', file] = process.argv.slice(2);
  if (operation === 'backup') {
    const output = await createEncryptedBackup();
    process.stdout.write(`${output}\n`);
    return;
  }
  if (operation === 'restore' && file) {
    await restoreEncryptedBackup(file);
    return;
  }
  throw new Error('Usage: encryptedBackup.ts backup | restore <encrypted-backup>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`Encrypted backup operation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
