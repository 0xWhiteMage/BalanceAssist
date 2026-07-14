CREATE OR REPLACE FUNCTION public.complete_orphaned_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.deletion_jobs SET state = 'completed', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND session_id IS NULL AND state IN ('claimed', 'processing') AND lease_token = p_lease_token
    AND NOT EXISTS (SELECT 1 FROM public.private_attachment_cleanup WHERE status = 'pending_cleanup');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) TO service_role; END IF;
END $$;
