# Local media worker

This container claims `media_processing_jobs` through lease-guarded RPCs. It uses only local Tesseract, Poppler, ffprobe/ffmpeg, and Pillow. It never calls a visual AI provider, transcribes audio, recognizes faces, or infers sensitive attributes.

Build and run:

```sh
docker build -t balance-assist-media-worker workers/media
docker run --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  -e SUPABASE_URL=https://project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  balance-assist-media-worker
```

Use a secret manager for the service-role key. Do not expose the worker publicly. Missing or failing local tools produce a bounded failure code; they never produce a successful placeholder result.
