import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const modulesRoot = fileURLToPath(new URL('../modules', import.meta.url));

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(target);
    return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
  }));
  return nested.flat();
}

test('module persistence imports are confined to services and repositories', async () => {
  const violations: string[] = [];
  for (const file of await typescriptFiles(modulesRoot)) {
    const source = await readFile(file, 'utf8');
    if (!/from\s+['"][^'"]*lib\/prisma\.js['"]/.test(source)) continue;
    if (!/\.(service|repository)\.ts$/.test(file)) {
      violations.push(path.relative(modulesRoot, file).replace(/\\/g, '/'));
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Prisma may only be imported by module services/repositories; violations: ${violations.join(', ')}`,
  );
});
