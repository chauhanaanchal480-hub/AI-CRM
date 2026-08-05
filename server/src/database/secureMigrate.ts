import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const production = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL or MIGRATION_DATABASE_URL is required for migrations');
if (production && !process.env.MIGRATION_DATABASE_URL) {
  throw new Error('MIGRATION_DATABASE_URL is required in production; application credentials must not run migrations');
}
if (production && process.env.MIGRATION_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('MIGRATION_DATABASE_URL must use a separate least-privilege migration role');
}

const migrationDir = path.resolve('prisma', 'migrations');
for (const entry of fs.readdirSync(migrationDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const sqlPath = path.join(migrationDir, entry.name, 'migration.sql');
  if (!fs.existsSync(sqlPath)) continue;
  const sql = fs.readFileSync(sqlPath, 'utf8').toLowerCase();
  if (!process.env.ALLOW_DESTRUCTIVE_MIGRATIONS && /\bdrop\s+(table|column|schema)\b/.test(sql)) {
    throw new Error(`Destructive SQL is blocked in ${entry.name}; set ALLOW_DESTRUCTIVE_MIGRATIONS only during an approved change`);
  }
}

const prismaCli = path.resolve('node_modules', 'prisma', 'build', 'index.js');
if (!fs.existsSync(prismaCli)) throw new Error('Prisma CLI is not installed');
const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  cwd: path.resolve('.'),
  env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_MIGRATE_SKIP_GENERATE: 'true' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
