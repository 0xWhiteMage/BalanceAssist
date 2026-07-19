# Local-only media processing

Migration `063_local_media_processing.sql` adds a service-role-only media job queue and private derivative registry. Migration `062` remains reserved for OAuth.

## Request flow

1. An authenticated session calls `POST /api/media/uploads/intent` with `operation`, `mimeType`, and `sizeBytes`.
2. The API checks analysis consent through `create_media_processing_job` and returns an opaque object key plus a Supabase signed-upload token. The browser uploads directly to private Supabase Storage, so video bytes do not cross Vercel.
3. The browser calls `POST /api/media/uploads/complete`. The API verifies private Storage metadata exactly matches the reservation before atomically moving the job to `queued`.
4. The private worker claims a lease, rechecks limits before decode, processes with local tools, uploads bounded private derivatives, and completes through a token-guarded RPC.
5. `GET /api/media/jobs/{jobId}` returns authenticated status. `GET /api/media/jobs/{jobId}/thumbnail` returns a 60-second private signed URL only for a successful, unexpired job.

The client should use Supabase Storage `uploadToSignedUrl(objectKey, token, file)` with the returned bucket. Upload tokens and thumbnail URLs must not be logged or persisted in analytics.

## Initial limits

| Input/output | Limit |
| --- | ---: |
| OCR and images | 10 MB |
| Videos | 50 MB and 10 minutes |
| Images/video frames | 25 megapixels |
| PDFs | 20 pages |
| Thumbnail | 512 px edge and 250 KB |
| Job attempts | 3 |
| Job result / JSON derivative | 256 KB |

Video duration and frame dimensions are verified by worker-side `ffprobe` before ffmpeg sampling. Declared byte sizes are checked by the API and checked again against downloaded bytes by the worker.

## Privacy and failure behavior

- There is no external visual provider.
- ffmpeg output is explicitly muted with `-an`; audio is not analyzed or transcribed.
- There is no face recognition, identity matching, biometric processing, or sensitive-attribute inference.
- Visual metrics are bounded scene-cut samples, dominant colors, and frame-difference motion values. They are not semantic classifications.
- Missing binaries, malformed metadata, excess dimensions/pages/duration, oversized output, cancellation, consent withdrawal, session deletion, and expiry all fail closed.
- Session deletion/expiry and analysis-consent withdrawal cancel jobs and queue source/derivative cleanup. The worker processes cleanup through leased RPCs.

## Operations

Set `SUPABASE_PRIVATE_MEDIA_BUCKET` to an existing private bucket. If omitted, the API may use `SUPABASE_PRIVATE_UPLOAD_BUCKET`. Do not create a public bucket or browser read policy.

Run the worker only in a private container environment with `SUPABASE_URL` and a service-role key from a secret manager. Require a read-only root filesystem, a bounded `/tmp` tmpfs, no inbound port, one CPU, 2 GB memory, 64 PIDs, and network egress restricted to Supabase. For Docker, enforce at least `--read-only --tmpfs /tmp:rw,noexec,nosuid,size=1g --cpus=1 --memory=2g --pids-limit=64`. Apply bucket lifecycle rules as defense in depth for abandoned signed uploads.

The worker intentionally logs no object contents, OCR text, signed URLs, tokens, filenames, or service credentials. Monitor aggregate job states and bounded `error_code` values instead.
