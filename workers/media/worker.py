import io
import json
import math
import os
import resource
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from collections.abc import Callable
from typing import Any

from PIL import Image, ImageChops
from supabase import Client, create_client

MAX_OCR_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 50 * 1024 * 1024
MAX_PIXELS = 25_000_000
MAX_PDF_PAGES = 20
MAX_VIDEO_SECONDS = 600
MAX_THUMBNAIL_BYTES = 250 * 1024
MAX_RESULT_BYTES = 256 * 1024
LEASE_SECONDS = 300
MAX_TOOL_OUTPUT_BYTES = 1024 * 1024
POLL_SECONDS = float(os.getenv("MEDIA_WORKER_POLL_SECONDS", "2"))
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ProcessingError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def required_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise ProcessingError("tool_unavailable")
    return path


def run(command: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    try:
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            completed = subprocess.run(
                command,
                check=True,
                stdout=stdout,
                stderr=stderr,
                timeout=timeout,
                preexec_fn=limit_native_process,
            )
            stdout.seek(0)
            stderr.seek(0)
            output = stdout.read(MAX_TOOL_OUTPUT_BYTES + 1)
            errors = stderr.read(MAX_TOOL_OUTPUT_BYTES + 1)
            if len(output) > MAX_TOOL_OUTPUT_BYTES or len(errors) > MAX_TOOL_OUTPUT_BYTES:
                raise ProcessingError("local_tool_output_limit")
            return subprocess.CompletedProcess(command, completed.returncode, output.decode("utf-8", "replace"), errors.decode("utf-8", "replace"))
    except (subprocess.SubprocessError, OSError) as error:
        raise ProcessingError("local_tool_failed") from error


def limit_native_process() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))


def thumbnail(image: Image.Image) -> tuple[bytes, int, int]:
    image = image.convert("RGB")
    image.thumbnail((512, 512), Image.Resampling.LANCZOS)
    for quality in (82, 72, 62, 52, 42):
        output = io.BytesIO()
        image.save(output, "WEBP", quality=quality, method=6)
        if output.tell() <= MAX_THUMBNAIL_BYTES:
            return output.getvalue(), image.width, image.height
    raise ProcessingError("thumbnail_too_large")


def check_image(path: Path) -> Image.Image:
    try:
        image = Image.open(path)
        if image.width * image.height > MAX_PIXELS:
            raise ProcessingError("image_pixel_limit")
        image.verify()
        image = Image.open(path)
        return image
    except ProcessingError:
        raise
    except Exception as error:
        raise ProcessingError("invalid_image") from error


def ocr_image(path: Path) -> tuple[dict[str, Any], Image.Image]:
    image = check_image(path)
    completed = run([required_tool("tesseract"), str(path), "stdout", "-l", "eng"], 120)
    text = completed.stdout[:200_000]
    return {"version": 1, "text": text, "truncated": len(completed.stdout) > len(text)}, image


def ocr_pdf(path: Path, work: Path, heartbeat: Callable[[], bool]) -> tuple[dict[str, Any], Image.Image]:
    info = run([required_tool("pdfinfo"), str(path)], 30).stdout
    pages_line = next((line for line in info.splitlines() if line.startswith("Pages:")), None)
    if not pages_line:
        raise ProcessingError("invalid_pdf")
    pages = int(pages_line.split(":", 1)[1].strip())
    if pages < 1 or pages > MAX_PDF_PAGES:
        raise ProcessingError("pdf_page_limit")
    chunks: list[str] = []
    truncated = False
    preview_path: Path | None = None
    for page_number in range(1, pages + 1):
        if not heartbeat():
            raise ProcessingError("lease_lost")
        prefix = work / f"page-{page_number}"
        run([required_tool("pdftoppm"), "-f", str(page_number), "-l", str(page_number),
             "-singlefile", "-r", "150", "-scale-to", "2500", "-png", str(path), str(prefix)], 60)
        page_path = prefix.with_suffix(".png")
        if not page_path.exists():
            raise ProcessingError("pdf_raster_failed")
        check_image(page_path)
        text = run([required_tool("tesseract"), str(page_path), "stdout", "-l", "eng"], 60).stdout
        remaining = 200_000 - sum(len(chunk) for chunk in chunks)
        if remaining <= 0:
            truncated = True
            break
        chunks.append(text[:remaining])
        truncated = truncated or len(text) > remaining
        if preview_path is None:
            preview_path = page_path
        else:
            page_path.unlink()
    if preview_path is None:
        raise ProcessingError("pdf_raster_failed")
    return {"version": 1, "text": "\n\f\n".join(chunks), "pages": pages, "truncated": truncated}, Image.open(preview_path)


def image_visual(path: Path) -> tuple[dict[str, Any], Image.Image]:
    image = check_image(path).convert("RGB")
    sample = image.copy()
    sample.thumbnail((256, 256))
    colors = sample.quantize(colors=8).convert("RGB").getcolors(sample.width * sample.height) or []
    palette = [
        {"rgb": list(color), "share": round(count / (sample.width * sample.height), 4)}
        for count, color in sorted(colors, reverse=True)[:8]
    ]
    return {"version": 1, "width": image.width, "height": image.height, "palette": palette}, image


def video_visual(path: Path, work: Path) -> tuple[dict[str, Any], Image.Image]:
    probe = json.loads(run([
        required_tool("ffprobe"), "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,width,height", "-of", "json", str(path)
    ], 30).stdout)
    try:
        duration = float(probe["format"]["duration"])
        video_stream = next(stream for stream in probe["streams"] if stream.get("codec_type") == "video")
        width, height = int(video_stream["width"]), int(video_stream["height"])
    except (KeyError, StopIteration, TypeError, ValueError) as error:
        raise ProcessingError("invalid_video_metadata") from error
    if not math.isfinite(duration) or duration <= 0 or duration > MAX_VIDEO_SECONDS:
        raise ProcessingError("video_duration_limit")
    if width * height > MAX_PIXELS:
        raise ProcessingError("video_frame_pixel_limit")
    frames = work / "frames"
    frames.mkdir()
    # Audio is explicitly discarded. Sampling is bounded to ten low-resolution frames.
    run([required_tool("ffmpeg"), "-v", "error", "-i", str(path), "-an", "-vf",
         "fps=1/10,scale=320:-2", "-frames:v", "10", str(frames / "%03d.png")], 180)
    paths = sorted(frames.glob("*.png"))
    if not paths:
        raise ProcessingError("video_decode_failed")
    images = [check_image(frame).convert("RGB") for frame in paths]
    motion: list[float] = []
    for previous, current in zip(images, images[1:]):
        difference = ImageChops.difference(previous.convert("L"), current.convert("L"))
        motion.append(round(sum(difference.getdata()) / (255 * difference.width * difference.height), 4))
    scene_cuts = [index + 1 for index, value in enumerate(motion) if value >= 0.28]
    palette_image = images[len(images) // 2].copy()
    palette_image.thumbnail((128, 128))
    colors = palette_image.quantize(colors=6).convert("RGB").getcolors(palette_image.width * palette_image.height) or []
    palette = [list(color) for _, color in sorted(colors, reverse=True)[:6]]
    return ({
        "version": 1,
        "duration_seconds": round(duration, 3),
        "width": width,
        "height": height,
        "sample_interval_seconds": 10,
        "scene_cut_sample_indexes": scene_cuts,
        "palette_rgb": palette,
        "motion_frame_difference": motion,
        "audio_processed": False
    }, images[0])


def upload_derivative(client: Client, bucket: str, job_id: str, kind: str, content: bytes, mime: str,
                      width: int | None = None, height: int | None = None) -> dict[str, Any]:
    suffix = "webp" if mime == "image/webp" else "json"
    key = f"media-derivatives/{job_id}/{uuid.uuid4()}.{suffix}"
    client.storage.from_(bucket).upload(key, content, {"content-type": mime, "upsert": False})
    return {"kind": kind, "bucket": bucket, "object_key": key, "mime_type": mime,
            "size_bytes": len(content), "width": width, "height": height}


def object_exists(client: Client, bucket: str, key: str) -> bool:
    directory, name = key.rsplit("/", 1)
    return any(item.get("name") == name for item in client.storage.from_(bucket).list(
        directory, {"limit": 100, "search": name}
    ))


def process_job(client: Client, job: dict[str, Any]) -> None:
    job_id, token = job["id"], job["lease_token"]
    max_bytes = MAX_VIDEO_BYTES if job["operation"] == "video_visual" else MAX_OCR_BYTES
    if int(job["actual_size_bytes"] or 0) < 1 or int(job["actual_size_bytes"]) > max_bytes:
        raise ProcessingError("source_size_limit")
    if client.rpc("start_media_processing_job", {"p_job_id": job_id, "p_lease_token": token}).execute().data is not True:
        return
    content = client.storage.from_(job["source_bucket"]).download(job["source_object_key"])
    if len(content) != int(job["actual_size_bytes"]) or len(content) > max_bytes:
        raise ProcessingError("download_size_mismatch")
    if client.rpc("renew_media_processing_job", {"p_job_id": job_id, "p_lease_token": token,
                                                   "p_lease_seconds": LEASE_SECONDS}).execute().data is not True:
        return

    derivatives: list[dict[str, Any]] = []
    def heartbeat() -> bool:
        return client.rpc("renew_media_processing_job", {
            "p_job_id": job_id, "p_lease_token": token, "p_lease_seconds": LEASE_SECONDS
        }).execute().data is True

    with tempfile.TemporaryDirectory(prefix="media-") as directory:
        work = Path(directory)
        source = work / "source"
        source.write_bytes(content)
        if job["operation"] == "ocr":
            result, preview = ocr_pdf(source, work, heartbeat) if job["actual_mime_type"] == "application/pdf" else ocr_image(source)
            result_kind = "ocr_json"
        elif job["operation"] == "image_visual":
            result, preview = image_visual(source)
            result_kind = "image_visual_json"
        else:
            result, preview = video_visual(source, work)
            result_kind = "video_visual_json"
        result_bytes = json.dumps(result, separators=(",", ":"), ensure_ascii=True).encode()
        if len(result_bytes) > MAX_RESULT_BYTES:
            raise ProcessingError("result_too_large")
        thumb, width, height = thumbnail(preview)
        if not heartbeat():
            return
        try:
            derivatives.append(upload_derivative(client, job["source_bucket"], job_id, "thumbnail", thumb, "image/webp", width, height))
            derivatives.append(upload_derivative(client, job["source_bucket"], job_id, result_kind, result_bytes, "application/json"))
            completed = client.rpc("complete_media_processing_job", {
                "p_job_id": job_id, "p_lease_token": token, "p_result": result, "p_derivatives": derivatives
            }).execute().data
            if completed is True:
                return
        except Exception:
            for derivative in derivatives:
                client.storage.from_(derivative["bucket"]).remove([derivative["object_key"]])
            raise
        for derivative in derivatives:
            client.storage.from_(derivative["bucket"]).remove([derivative["object_key"]])


def cleanup_one(client: Client) -> bool:
    rows = client.rpc("claim_media_cleanup", {"p_lease_seconds": LEASE_SECONDS}).execute().data or []
    if not rows:
        return False
    cleanup = rows[0]
    objects: dict[str, list[str]] = {cleanup["source_bucket"]: [cleanup["source_object_key"]]}
    for derivative in cleanup.get("derivatives") or []:
        objects.setdefault(derivative["bucket"], []).append(derivative["object_key"])
    derivative_prefix = f"media-derivatives/{cleanup['job_id']}"
    for item in client.storage.from_(cleanup["source_bucket"]).list(derivative_prefix, {"limit": 100}):
        if item.get("name"):
            objects.setdefault(cleanup["source_bucket"], []).append(f"{derivative_prefix}/{item['name']}")
    for bucket, keys in objects.items():
        unique_keys = list(dict.fromkeys(keys))
        client.storage.from_(bucket).remove(unique_keys)
        if any(object_exists(client, bucket, key) for key in unique_keys):
            raise ProcessingError("cleanup_incomplete")
    completed = client.rpc("complete_media_cleanup", {"p_job_id": cleanup["job_id"],
                                                         "p_cleanup_token": cleanup["cleanup_token"]}).execute().data
    if completed is not True:
        raise ProcessingError("cleanup_lease_lost")
    return True


def main() -> None:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL and a Supabase service-role key are required")
    client = create_client(url, key)
    while True:
        try:
            cleanup_one(client)
            rows = client.rpc("claim_media_processing_job", {"p_lease_seconds": LEASE_SECONDS}).execute().data or []
            if not rows:
                time.sleep(POLL_SECONDS)
                continue
            job = rows[0]
            try:
                process_job(client, job)
            except ProcessingError as error:
                client.rpc("fail_media_processing_job", {"p_job_id": job["id"],
                                                           "p_lease_token": job["lease_token"],
                                                           "p_error_code": error.code}).execute()
            except Exception:
                client.rpc("fail_media_processing_job", {"p_job_id": job["id"],
                                                           "p_lease_token": job["lease_token"],
                                                           "p_error_code": "worker_internal_error"}).execute()
        except Exception:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
