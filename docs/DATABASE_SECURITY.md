# Enterprise database security (Phase 2.8)

## Credentials and roles

Provision `server/prisma/security/roles.sql` once, after the initial schema is deployed, from an approved PostgreSQL security-administrator session. Set independent passwords through the deployment secret manager; never place them in the SQL file.

- `ai_crm_app`: API `SELECT`, `INSERT`, and `UPDATE`; no DDL or CRM hard delete. It has narrowly scoped `DELETE` access only for expiring nonce, idempotency, password-history, and MFA records that the API owns.
- `ai_crm_migrator`: owns Prisma schema objects and is used only through `MIGRATION_DATABASE_URL`.
- `ai_crm_backup`: read-only credential used only through `BACKUP_DATABASE_URL`.
- `ai_crm_retention`: restricted hard-delete worker credential used only through `RETENTION_DATABASE_URL`.

Production URLs must enforce PostgreSQL TLS. Run `npm run db:migrate:secure --workspace server`; destructive migration SQL is rejected unless an approved deployment explicitly sets `ALLOW_DESTRUCTIVE_MIGRATIONS`.

## Field encryption

The API encrypts sensitive CRM strings and audit/activity JSON with AES-256-GCM before Prisma writes them. `ENCRYPTION_KEYS` is a versioned keyring, `ENCRYPTION_CURRENT_KEY_ID` selects the write key, and `FIELD_SEARCH_KEY` is a separate stable 32-byte HMAC key for blind email search indexes. After deployment, run `npm run db:security:backfill --workspace server`; it is bounded, restartable, and idempotent.

Keep retired AES keys available until the restartable backfill has rewritten active and soft-deleted records with the current key and backup retention has expired. Rotate the blind-index key only with a full approved reindex/backfill window.

## Query monitoring and retention

Prisma emits query fingerprints and duration only; query text and parameters are never logged. Queries over `DB_QUERY_SLOW_MS` are always warned and healthy queries are sampled using `DB_QUERY_LOG_SAMPLE_RATE`.

The retention worker uses a transaction-scoped PostgreSQL advisory lock. It purges expired security artifacts, enforces audit/auth/soft-delete retention windows, records each run in `DataRetentionRun`, and removes retained upload objects only after their soft-delete window expires.

## Encrypted backups

Run `npm run db:backup --workspace server` from a built operations artifact with `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY_ID`, and a dedicated 32-byte `BACKUP_ENCRYPTION_KEY`. Backups stream from `pg_dump` into AES-256-GCM authenticated ciphertext; no plaintext dump is written. A checksum manifest is emitted alongside each backup and old matching backups are pruned using `BACKUP_RETENTION_DAYS`.

Restore into a prepared database with `npm run db:restore --workspace server -- <path>`. The command authenticates the entire backup before streaming a second decryption pass to `pg_restore`. Regular restore drills and off-site immutable storage remain operational deployment responsibilities.
