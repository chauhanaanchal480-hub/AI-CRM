-- Run once by a PostgreSQL security administrator.  The application role is
-- deliberately not a superuser, database owner, or migration role.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_crm_app') THEN
    CREATE ROLE ai_crm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_crm_migrator') THEN
    CREATE ROLE ai_crm_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_crm_backup') THEN
    CREATE ROLE ai_crm_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_crm_retention') THEN
    CREATE ROLE ai_crm_retention LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO ai_crm_app, ai_crm_migrator, ai_crm_backup, ai_crm_retention',
    current_database()
  );
END $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ai_crm_app, ai_crm_migrator, ai_crm_backup, ai_crm_retention;
ALTER SCHEMA public OWNER TO ai_crm_migrator;

-- Prisma's deploy role must own schema objects to apply future ALTERs, while
-- the API, backup, and retention roles receive only explicit data privileges.
DO $$
DECLARE object_record RECORD;
BEGIN
  FOR object_record IN
    SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO ai_crm_migrator', object_record.schemaname, object_record.tablename);
  END LOOP;
  FOR object_record IN
    SELECT sequence_schema, sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO ai_crm_migrator', object_record.sequence_schema, object_record.sequence_name);
  END LOOP;
  FOR object_record IN
    SELECT n.nspname AS schema_name, t.typname AS type_name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO ai_crm_migrator', object_record.schema_name, object_record.type_name);
  END LOOP;
END $$;

-- Existing objects.  Default privileges below cover future Prisma migrations.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ai_crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_crm_app;
-- The API hard-deletes only bounded, short-lived security artifacts. CRM data
-- remains protected by the no-DELETE default and application soft deletes.
GRANT DELETE ON TABLE
  "ApiRequestNonce", "ApiIdempotencyRecord", "PasswordHistory", "MfaChallenge", "MfaRecoveryCode"
  TO ai_crm_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_crm_backup;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_crm_backup;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ai_crm_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ai_crm_migrator;
GRANT SELECT, DELETE ON TABLE
  "Customer", "Lead", "Deal", "Task", "Activity", "Note", "EmailLog", "Attachment", "Notification", "AiInsight",
  "ApiRequestNonce", "ApiIdempotencyRecord", "MfaChallenge", "TrustedDevice", "RefreshToken", "Session", "LoginHistory", "AuditLog"
  TO ai_crm_retention;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "DataRetentionRun" TO ai_crm_retention;
REVOKE ALL ON TABLE "_prisma_migrations" FROM ai_crm_app, ai_crm_retention;

ALTER DEFAULT PRIVILEGES FOR ROLE ai_crm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO ai_crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ai_crm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ai_crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ai_crm_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO ai_crm_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE ai_crm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ai_crm_backup;

ALTER ROLE ai_crm_app SET statement_timeout = '30s';
ALTER ROLE ai_crm_app SET lock_timeout = '5s';
ALTER ROLE ai_crm_app SET idle_in_transaction_session_timeout = '60s';

COMMIT;
