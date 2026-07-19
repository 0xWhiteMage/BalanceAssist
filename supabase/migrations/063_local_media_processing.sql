-- Local-only asynchronous media processing. Storage objects remain private and
-- all table/function access is restricted to the service role.
CREATE TABLE public.media_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  operation text NOT NULL CHECK (operation IN ('ocr', 'image_visual', 'video_visual')),
  state text NOT NULL DEFAULT 'awaiting_upload' CHECK (state IN (
    'awaiting_upload', 'queued', 'claimed', 'processing', 'succeeded', 'failed', 'cancelled', 'expired'
  )),
  source_bucket text NOT NULL CHECK (source_bucket ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  source_object_key text NOT NULL UNIQUE CHECK (
    source_object_key ~ '^media/[0-9a-f]{2}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  declared_mime_type text NOT NULL CHECK (length(declared_mime_type) BETWEEN 3 AND 127),
  declared_size_bytes bigint NOT NULL CHECK (declared_size_bytes BETWEEN 1 AND 52428800),
  actual_mime_type text CHECK (actual_mime_type IS NULL OR length(actual_mime_type) BETWEEN 3 AND 127),
  actual_size_bytes bigint CHECK (actual_size_bytes IS NULL OR actual_size_bytes BETWEEN 1 AND 52428800),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND pg_column_size(result) <= 262144)),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,64}$'),
  cancel_reason text CHECK (cancel_reason IS NULL OR cancel_reason ~ '^[a-z0-9_]{1,64}$'),
  upload_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  cleanup_state text NOT NULL DEFAULT 'retained' CHECK (cleanup_state IN ('retained', 'pending', 'claimed', 'complete')),
  cleanup_token uuid,
  cleanup_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  processing_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz
);

CREATE INDEX media_processing_jobs_claim_idx ON public.media_processing_jobs (state, lease_expires_at, created_at);
CREATE INDEX media_processing_jobs_session_idx ON public.media_processing_jobs (session_id, created_at DESC);
CREATE INDEX media_processing_jobs_expiry_idx ON public.media_processing_jobs (expires_at) WHERE cleanup_state <> 'complete';
CREATE INDEX media_processing_jobs_cleanup_idx ON public.media_processing_jobs (cleanup_state, cleanup_lease_expires_at);

CREATE TABLE public.media_derivatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.media_processing_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('thumbnail', 'ocr_json', 'video_visual_json', 'image_visual_json')),
  bucket text NOT NULL CHECK (bucket ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  object_key text NOT NULL UNIQUE CHECK (object_key ~ '^media-derivatives/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|json)$'),
  mime_type text NOT NULL CHECK (mime_type IN ('image/webp', 'application/json')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 262144),
  width integer CHECK (width IS NULL OR width BETWEEN 1 AND 512),
  height integer CHECK (height IS NULL OR height BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, kind),
  CHECK (kind <> 'thumbnail' OR (mime_type = 'image/webp' AND size_bytes <= 256000 AND width IS NOT NULL AND height IS NOT NULL)),
  CHECK (kind = 'thumbnail' OR (mime_type = 'application/json' AND width IS NULL AND height IS NULL))
);
CREATE INDEX media_derivatives_job_idx ON public.media_derivatives(job_id);

ALTER TABLE public.media_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_derivatives ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.media_processing_jobs, public.media_derivatives FROM PUBLIC;

CREATE FUNCTION public.private_media_storage_is_ready(p_bucket text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH RECURSIVE memberships(role_oid) AS (
    SELECT r.oid FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
    UNION
    SELECT m.roleid FROM memberships current_roles JOIN pg_auth_members m ON m.member = current_roles.role_oid
  ), role_names AS (
    SELECT r.rolname AS role_name FROM memberships m JOIN pg_roles r ON r.oid = m.role_oid
  )
  SELECT p_bucket ~ '^[a-z0-9][a-z0-9-]{2,62}$'
    AND to_regclass('storage.buckets') IS NOT NULL
    AND to_regclass('storage.objects') IS NOT NULL
    AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = p_bucket AND public = false)
    AND EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
        AND ('public'::name = ANY(p.roles) OR EXISTS (SELECT 1 FROM role_names WHERE role_name = ANY(p.roles)))
    );
$$;

CREATE OR REPLACE FUNCTION public.reserve_session_upload_quota(
  p_session_id uuid,
  p_size_bytes bigint,
  p_max_bytes bigint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE reservation_id uuid; used_bytes bigint;
BEGIN
  IF p_size_bytes < 1 OR p_max_bytes < 1 OR p_size_bytes > p_max_bytes THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  DELETE FROM public.session_upload_reservations WHERE expires_at <= now();
  SELECT
    COALESCE((SELECT sum(size_bytes) FROM public.uploaded_files
      WHERE session_id = p_session_id AND (status IS NULL OR status NOT IN ('expired', 'suppressed'))), 0) +
    COALESCE((SELECT sum(size_bytes) FROM public.session_upload_reservations WHERE session_id = p_session_id), 0) +
    COALESCE((SELECT sum(declared_size_bytes) FROM public.media_processing_jobs
      WHERE session_id = p_session_id AND cleanup_state <> 'complete'), 0)
  INTO used_bytes;
  IF used_bytes + p_size_bytes > p_max_bytes THEN RETURN NULL; END IF;
  INSERT INTO public.session_upload_reservations(session_id, size_bytes)
  VALUES (p_session_id, p_size_bytes) RETURNING id INTO reservation_id;
  RETURN reservation_id;
END $$;

CREATE FUNCTION public.create_media_processing_job(
  p_session_id uuid,
  p_operation text,
  p_source_bucket text,
  p_source_object_key text,
  p_declared_mime_type text,
  p_declared_size_bytes bigint
) RETURNS SETOF public.media_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_session public.sessions%ROWTYPE; v_allowed boolean; v_used_bytes bigint;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR KEY SHARE;
  IF NOT FOUND OR v_session.deletion_state <> 'active' OR v_session.draft_expires_at <= now() THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  SELECT public.assert_session_processing_allowed(p_session_id) INTO v_allowed;
  IF v_allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'ANALYSIS_CONSENT_REQUIRED' USING ERRCODE = '55000'; END IF;
  IF p_operation NOT IN ('ocr', 'image_visual', 'video_visual')
     OR p_declared_size_bytes < 1
     OR (p_operation = 'video_visual' AND (p_declared_size_bytes > 52428800 OR p_declared_mime_type NOT IN ('video/mp4', 'video/quicktime', 'video/webm')))
     OR (p_operation = 'image_visual' AND (p_declared_size_bytes > 10485760 OR p_declared_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/tiff')))
     OR (p_operation = 'ocr' AND (p_declared_size_bytes > 10485760 OR p_declared_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'application/pdf'))) THEN
    RAISE EXCEPTION 'INVALID_MEDIA_JOB' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  DELETE FROM public.session_upload_reservations WHERE expires_at <= now();
  SELECT
    COALESCE((SELECT sum(size_bytes) FROM public.uploaded_files
      WHERE session_id = p_session_id AND (status IS NULL OR status NOT IN ('expired', 'suppressed'))), 0) +
    COALESCE((SELECT sum(size_bytes) FROM public.session_upload_reservations WHERE session_id = p_session_id), 0) +
    COALESCE((SELECT sum(declared_size_bytes) FROM public.media_processing_jobs
      WHERE session_id = p_session_id AND cleanup_state <> 'complete'), 0)
  INTO v_used_bytes;
  IF v_used_bytes + p_declared_size_bytes > 104857600 THEN
    RAISE EXCEPTION 'UPLOAD_QUOTA_EXCEEDED' USING ERRCODE = '54000';
  END IF;
  RETURN QUERY INSERT INTO public.media_processing_jobs (
    session_id, operation, source_bucket, source_object_key, declared_mime_type,
    declared_size_bytes, upload_expires_at, expires_at
  ) VALUES (
    p_session_id, p_operation, p_source_bucket, p_source_object_key, p_declared_mime_type,
    p_declared_size_bytes, now() + interval '125 minutes', v_session.draft_expires_at
  ) RETURNING *;
END $$;

CREATE FUNCTION public.finalize_media_upload(
  p_job_id uuid, p_session_id uuid, p_actual_size_bytes bigint, p_actual_mime_type text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_job public.media_processing_jobs%ROWTYPE; v_allowed boolean;
BEGIN
  SELECT * INTO v_job FROM public.media_processing_jobs WHERE id = p_job_id AND session_id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_job.state <> 'awaiting_upload' OR v_job.upload_expires_at <= now() THEN RETURN false; END IF;
  BEGIN SELECT public.assert_session_processing_allowed(p_session_id) INTO v_allowed;
  EXCEPTION WHEN OTHERS THEN RETURN false; END;
  IF v_allowed IS DISTINCT FROM true OR p_actual_size_bytes <> v_job.declared_size_bytes
     OR p_actual_mime_type <> v_job.declared_mime_type THEN RETURN false; END IF;
  UPDATE public.media_processing_jobs SET state = 'queued', actual_size_bytes = p_actual_size_bytes,
    actual_mime_type = p_actual_mime_type, updated_at = now() WHERE id = p_job_id;
  RETURN true;
END $$;

CREATE FUNCTION public.expire_media_processing_jobs() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.media_processing_jobs SET state = 'failed', error_code = 'attempts_exhausted', failed_at = now(),
    cleanup_state = 'pending', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE state IN ('claimed', 'processing') AND attempts >= 3 AND lease_expires_at <= now();
  UPDATE public.media_processing_jobs SET state = 'expired', cleanup_state = 'pending',
    lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE state NOT IN ('cancelled', 'expired') AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

CREATE FUNCTION public.claim_media_processing_job(p_lease_seconds integer DEFAULT 300)
RETURNS SETOF public.media_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN RAISE EXCEPTION 'invalid lease'; END IF;
  PERFORM public.expire_media_processing_jobs();
  SELECT j.id INTO v_id FROM public.media_processing_jobs j
  WHERE (j.state = 'queued' OR (j.state IN ('claimed', 'processing') AND j.lease_expires_at <= now()))
    AND j.attempts < 3 AND j.expires_at > now()
    AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = j.session_id AND s.deletion_state = 'active' AND s.draft_expires_at > now())
    AND (SELECT c.granted AND c.notice_version = '1.2' FROM public.session_consents c
      WHERE c.session_id = j.session_id AND c.scope = 'analysis'
      ORDER BY c.created_at DESC, c.id DESC LIMIT 1) IS TRUE
  ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.media_processing_jobs SET state = 'claimed', attempts = attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    claimed_at = now(), updated_at = now() WHERE id = v_id RETURNING *;
END $$;

CREATE FUNCTION public.start_media_processing_job(p_job_id uuid, p_lease_token uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.media_processing_jobs SET state = 'processing', processing_at = now(), updated_at = now()
  WHERE id = p_job_id AND state = 'claimed' AND lease_token = p_lease_token
    AND lease_expires_at > now() AND expires_at > now() RETURNING true;
$$;

CREATE FUNCTION public.renew_media_processing_job(p_job_id uuid, p_lease_token uuid, p_lease_seconds integer DEFAULT 300) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN RETURN false; END IF;
  UPDATE public.media_processing_jobs j SET lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  WHERE j.id = p_job_id AND j.state = 'processing' AND j.lease_token = p_lease_token
    AND j.lease_expires_at > now() AND j.expires_at > now()
    AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = j.session_id AND s.deletion_state = 'active' AND s.draft_expires_at > now())
    AND (SELECT c.granted AND c.notice_version = '1.2' FROM public.session_consents c
      WHERE c.session_id = j.session_id AND c.scope = 'analysis'
      ORDER BY c.created_at DESC, c.id DESC LIMIT 1) IS TRUE;
  RETURN FOUND;
END $$;

CREATE FUNCTION public.complete_media_processing_job(
  p_job_id uuid, p_lease_token uuid, p_result jsonb, p_derivatives jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item jsonb; v_locked_id uuid;
BEGIN
  IF jsonb_typeof(p_result) <> 'object' OR pg_column_size(p_result) > 262144
     OR jsonb_typeof(p_derivatives) <> 'array' OR jsonb_array_length(p_derivatives) > 4 THEN RETURN false; END IF;
  SELECT id INTO v_locked_id FROM public.media_processing_jobs
  WHERE id = p_job_id AND state = 'processing' AND lease_token = p_lease_token
    AND lease_expires_at > now() AND expires_at > now() FOR UPDATE;
  IF v_locked_id IS NULL THEN RETURN false; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_derivatives) LOOP
    INSERT INTO public.media_derivatives(job_id, kind, bucket, object_key, mime_type, size_bytes, width, height)
    VALUES (p_job_id, v_item->>'kind', v_item->>'bucket', v_item->>'object_key', v_item->>'mime_type',
      (v_item->>'size_bytes')::integer, (v_item->>'width')::integer, (v_item->>'height')::integer);
  END LOOP;
  UPDATE public.media_processing_jobs SET state = 'succeeded', result = p_result,
    lease_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now() WHERE id = p_job_id;
  RETURN true;
EXCEPTION WHEN check_violation OR unique_violation OR invalid_text_representation THEN RETURN false;
END $$;

CREATE FUNCTION public.fail_media_processing_job(p_job_id uuid, p_lease_token uuid, p_error_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_attempts integer;
BEGIN
  IF p_error_code !~ '^[a-z0-9_]{1,64}$' THEN RETURN false; END IF;
  SELECT attempts INTO v_attempts FROM public.media_processing_jobs
  WHERE id = p_job_id AND state IN ('claimed', 'processing') AND lease_token = p_lease_token FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.media_processing_jobs SET state = CASE WHEN v_attempts < 3 THEN 'queued' ELSE 'failed' END,
    cleanup_state = CASE WHEN v_attempts < 3 THEN cleanup_state ELSE 'pending' END,
    error_code = p_error_code, failed_at = CASE WHEN v_attempts >= 3 THEN now() ELSE failed_at END,
    lease_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = p_job_id;
  RETURN true;
END $$;

CREATE FUNCTION public.cancel_media_processing_job(p_job_id uuid, p_reason text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.media_processing_jobs SET state = 'cancelled', cancel_reason = p_reason,
    cleanup_state = 'pending', lease_token = NULL, lease_expires_at = NULL, cancelled_at = now(), updated_at = now()
  WHERE id = p_job_id AND state NOT IN ('cancelled', 'expired') AND p_reason ~ '^[a-z0-9_]{1,64}$' RETURNING true;
$$;

CREATE FUNCTION public.claim_media_cleanup(p_lease_seconds integer DEFAULT 300)
RETURNS TABLE(job_id uuid, cleanup_token uuid, source_bucket text, source_object_key text, derivatives jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN RAISE EXCEPTION 'invalid cleanup lease'; END IF;
  PERFORM public.expire_media_processing_jobs();
  SELECT id INTO v_id FROM public.media_processing_jobs
  WHERE upload_expires_at <= now()
    AND (cleanup_state = 'pending' OR (cleanup_state = 'claimed' AND cleanup_lease_expires_at <= now()))
  ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  UPDATE public.media_processing_jobs SET cleanup_state = 'claimed', cleanup_token = v_token,
    cleanup_lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now() WHERE id = v_id;
  RETURN QUERY SELECT j.id, v_token, j.source_bucket, j.source_object_key,
    COALESCE(jsonb_agg(jsonb_build_object('bucket', d.bucket, 'object_key', d.object_key)) FILTER (WHERE d.id IS NOT NULL), '[]'::jsonb)
  FROM public.media_processing_jobs j LEFT JOIN public.media_derivatives d ON d.job_id = j.id
  WHERE j.id = v_id GROUP BY j.id;
END $$;

CREATE FUNCTION public.complete_media_cleanup(p_job_id uuid, p_cleanup_token uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.media_processing_jobs SET cleanup_state = 'complete', cleanup_token = NULL,
    cleanup_lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND cleanup_state = 'claimed' AND cleanup_token = p_cleanup_token
    AND cleanup_lease_expires_at > now() RETURNING true;
$$;

CREATE FUNCTION public.cancel_session_media_jobs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.deletion_state = 'active' AND NEW.deletion_state <> 'active')
     OR (TG_OP = 'UPDATE' AND OLD.draft_expires_at > now() AND NEW.draft_expires_at <= now()) THEN
    UPDATE public.media_processing_jobs SET state = CASE WHEN NEW.draft_expires_at <= now() THEN 'expired' ELSE 'cancelled' END,
      cancel_reason = CASE WHEN NEW.draft_expires_at <= now() THEN 'session_expired' ELSE 'session_deletion_requested' END,
      cleanup_state = 'pending', lease_token = NULL, lease_expires_at = NULL, cancelled_at = now(), updated_at = now()
    WHERE session_id = NEW.id AND state NOT IN ('cancelled', 'expired');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sessions_cancel_media_jobs BEFORE UPDATE OF deletion_state, draft_expires_at ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.cancel_session_media_jobs();

CREATE FUNCTION public.cancel_media_jobs_on_consent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.scope = 'analysis' AND NEW.granted = false THEN
    UPDATE public.media_processing_jobs SET state = 'cancelled', cancel_reason = 'analysis_consent_revoked',
      cleanup_state = 'pending', lease_token = NULL, lease_expires_at = NULL, cancelled_at = now(), updated_at = now()
    WHERE session_id = NEW.session_id AND state NOT IN ('cancelled', 'expired');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_consents_cancel_media_jobs AFTER INSERT ON public.session_consents
FOR EACH ROW EXECUTE FUNCTION public.cancel_media_jobs_on_consent();

REVOKE ALL ON FUNCTION public.create_media_processing_job(uuid, text, text, text, text, bigint),
  public.finalize_media_upload(uuid, uuid, bigint, text), public.expire_media_processing_jobs(),
  public.claim_media_processing_job(integer), public.start_media_processing_job(uuid, uuid),
  public.renew_media_processing_job(uuid, uuid, integer), public.complete_media_processing_job(uuid, uuid, jsonb, jsonb),
  public.fail_media_processing_job(uuid, uuid, text), public.cancel_media_processing_job(uuid, text),
  public.claim_media_cleanup(integer), public.complete_media_cleanup(uuid, uuid),
  public.cancel_session_media_jobs(), public.cancel_media_jobs_on_consent(),
  public.private_media_storage_is_ready(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.media_processing_jobs, public.media_derivatives FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.media_processing_jobs, public.media_derivatives FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_processing_jobs, public.media_derivatives TO service_role;
    GRANT EXECUTE ON FUNCTION public.create_media_processing_job(uuid, text, text, text, text, bigint),
      public.finalize_media_upload(uuid, uuid, bigint, text), public.expire_media_processing_jobs(),
      public.claim_media_processing_job(integer), public.start_media_processing_job(uuid, uuid),
      public.renew_media_processing_job(uuid, uuid, integer), public.complete_media_processing_job(uuid, uuid, jsonb, jsonb),
      public.fail_media_processing_job(uuid, uuid, text), public.cancel_media_processing_job(uuid, text),
      public.claim_media_cleanup(integer), public.complete_media_cleanup(uuid, uuid),
      public.private_media_storage_is_ready(text) TO service_role;
  END IF;
END $$;
