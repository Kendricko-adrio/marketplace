-- Reset DATA staging saja. Bukan migration dan bukan pengganti preflight journal.
-- Caller wajib menghentikan seluruh writer/jobs dan memeriksa journal release.
-- Gunakan psql -X -v ON_ERROR_STOP=1; empat session settings wajib diisi.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $reset$
DECLARE
  expected_database text := nullif(btrim(current_setting('app.staging_reset_expected_database', true)), '');
  expected_role text := nullif(btrim(current_setting('app.staging_reset_expected_role', true)), '');
  confirmation text := nullif(btrim(current_setting('app.staging_reset_confirmation', true)), '');
  target_tables text;
BEGIN
  IF current_setting('app.deployment_environment', true) IS DISTINCT FROM 'staging'
     OR expected_database IS NULL OR expected_role IS NULL OR confirmation IS NULL THEN
    RAISE EXCEPTION 'STAGING_RESET_REFUSED: explicit staging settings required';
  END IF;
  IF current_database() <> expected_database OR current_user <> expected_role
     OR confirmation <> expected_database THEN
    RAISE EXCEPTION 'STAGING_RESET_REFUSED: database, role or confirmation mismatch';
  END IF;
  IF current_database() ~* 'production|(^|[_-])prod([_-]|$)'
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'STAGING_RESET_REFUSED: production target or superuser forbidden';
  END IF;
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'STAGING_RESET_REFUSED: migration journal required';
  END IF;
  -- Semua referencing table wajib berada di public. RESTRICT di bawah menjadi
  -- pengaman kedua: tidak pernah memperluas TRUNCATE ke schema lain via CASCADE.
  IF EXISTS (
    SELECT 1 FROM pg_constraint fk
    JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND parent_ns.nspname = 'public'
      AND child_ns.nspname <> 'public'
  ) OR EXISTS (
    SELECT 1 FROM pg_inherits inheritance
    JOIN pg_class parent ON parent.oid = inheritance.inhparent
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN pg_class child ON child.oid = inheritance.inhrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE parent_ns.nspname = 'public' AND child_ns.nspname <> 'public'
  ) THEN
    RAISE EXCEPTION 'STAGING_RESET_REFUSED: dependency outside public';
  END IF;
  SELECT string_agg(format('%I.%I', namespace.nspname, relation.relname), ', ' ORDER BY relation.relname)
    INTO target_tables
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
      AND NOT relation.relispartition;
  IF target_tables IS NULL THEN
    RAISE EXCEPTION 'STAGING_RESET_REFUSED: no application tables';
  END IF;
  EXECUTE 'TRUNCATE TABLE ' || target_tables || ' CONTINUE IDENTITY RESTRICT';
  RAISE NOTICE 'STAGING_DATA_RESET_APPLIED';
END
$reset$;
COMMIT;
