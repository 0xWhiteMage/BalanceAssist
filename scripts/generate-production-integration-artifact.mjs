import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrations = [
  ['062', '062_monday_oauth_2_1.sql'],
  ['063', '063_local_media_processing.sql'],
];
const sections = migrations.map(([version, filename]) => {
  const source = readFileSync(resolve(process.cwd(), 'supabase/migrations', filename), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  return `-- BEGIN ${version} ${filename}\n${source}\n-- END ${version} ${filename}`;
});
const artifact = `BEGIN;
SELECT pg_advisory_xact_lock(90442053);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '061' AND filename = '061_api_security_retention_and_upload_quota.sql') THEN
    RAISE EXCEPTION 'integration migration baseline 061 is not recorded with its reviewed filename';
  END IF;
  IF to_regprocedure('public.assert_session_processing_allowed(uuid)') IS NULL
     OR to_regprocedure('public.reserve_session_upload_quota(uuid,bigint,bigint)') IS NULL THEN
    RAISE EXCEPTION 'integration migration baseline schema signatures are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version IN ('062', '063')) THEN
    RAISE EXCEPTION 'reviewed integration migration range is not empty';
  END IF;
END $$;

${sections.join('\n\n')}

INSERT INTO public.schema_migrations(version, filename) VALUES
  ('062', '062_monday_oauth_2_1.sql'),
  ('063', '063_local_media_processing.sql');
COMMIT;
`;
writeFileSync(resolve(process.cwd(), 'supabase/production-integrations-062-063.sql'), artifact, 'utf8');
