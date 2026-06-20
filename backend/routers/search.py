"""
Search router — triggers face recognition and keyword search pipelines.
"""

import json
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

router = APIRouter()

# Max seconds a job is allowed to run before being forcibly marked failed
JOB_TIMEOUT_SECONDS = 600

BASE_DIR = Path(__file__).parent.parent
UPLOADS_DIR = BASE_DIR / "storage" / "uploads"
REFERENCES_DIR = BASE_DIR / "storage" / "references"
RESULTS_DIR = BASE_DIR / "storage" / "results"

# In-memory job tracker (resets on server restart; fine for hackathon)
_jobs: dict[str, dict[str, Any]] = {}


class ImageSearchRequest(BaseModel):
    video_ids: list[str] = Field(..., description="List of uploaded video IDs to search")
    reference_ids: list[str] = Field(..., description="List of reference image IDs")
    confidence_threshold: float = Field(0.65, ge=0.0, le=1.0)
    similarity_threshold: float = Field(0.70, ge=0.0, le=1.0)
    sample_fps: float = Field(1.0, ge=0.1, le=10.0)
    start_time: float | None = Field(None, description="Start time filter in seconds")
    end_time: float | None = Field(None, description="End time filter in seconds")


class KeywordSearchRequest(BaseModel):
    video_ids: list[str] = Field(..., description="List of uploaded video IDs to search")
    keyword: str = Field(..., min_length=1, description="Natural-language search query")
    similarity_threshold: float = Field(0.25, ge=0.0, le=1.0)
    sample_fps: float = Field(1.0, ge=0.1, le=10.0)
    start_time: float | None = Field(None, description="Start time filter in seconds")
    end_time: float | None = Field(None, description="End time filter in seconds")


class LprSearchRequest(BaseModel):
    video_ids: list[str] = Field(..., description="List of uploaded video IDs to search")
    plate_text: str = Field(..., min_length=1, description="License plate characters to match")
    similarity_threshold: float = Field(0.50, ge=0.0, le=1.0)
    sample_fps: float = Field(1.0, ge=0.1, le=10.0)
    start_time: float | None = Field(None, description="Start time filter in seconds")
    end_time: float | None = Field(None, description="End time filter in seconds")


def _resolve_video(video_id: str) -> tuple[Path, dict]:
    meta_file = UPLOADS_DIR / f"{video_id}.meta.json"
    if not meta_file.exists():
        raise HTTPException(status_code=404, detail=f"Video '{video_id}' not found")
    meta = json.loads(meta_file.read_text())
    video_path = UPLOADS_DIR / meta["stored_filename"]
    if not video_path.exists():
        raise HTTPException(status_code=404, detail=f"Video file for '{video_id}' missing from disk")
    return video_path, meta


def _resolve_reference(ref_id: str) -> Path:
    meta_file = REFERENCES_DIR / f"{ref_id}.meta.json"
    if not meta_file.exists():
        raise HTTPException(status_code=404, detail=f"Reference '{ref_id}' not found")
    meta = json.loads(meta_file.read_text())
    ref_path = REFERENCES_DIR / meta["stored_filename"]
    if not ref_path.exists():
        raise HTTPException(status_code=404, detail=f"Reference file for '{ref_id}' missing")
    return ref_path


def _run_face_search_task(job_id: str, request: ImageSearchRequest):
    """Background task for face recognition search."""
    from ai_pipeline.face_recognition import run_face_recognition_search  # noqa: PLC0415

    _jobs[job_id]["status"] = "running"
    _jobs[job_id]["started_at"] = time.time()
    all_matches = []

    try:
        ref_paths = [_resolve_reference(rid) for rid in request.reference_ids]

        for vid_id in request.video_ids:
            # Timeout guard
            if time.time() - _jobs[job_id]["started_at"] > JOB_TIMEOUT_SECONDS:
                raise TimeoutError("Job exceeded maximum allowed runtime")

            video_path, meta = _resolve_video(vid_id)
            sub_job_id = f"{job_id}_{vid_id}"
            matches = run_face_recognition_search(
                video_path=video_path,
                reference_image_paths=ref_paths,
                camera_id=meta.get("camera_id", "CAM-01"),
                confidence_threshold=request.confidence_threshold,
                similarity_threshold=request.similarity_threshold,
                sample_fps=request.sample_fps,
                job_id=sub_job_id,
                start_time=request.start_time,
                end_time=request.end_time,
                progress_cb=lambda p, m: _update_progress(job_id, p, m),
            )
            all_matches.extend(matches)

        _jobs[job_id]["status"] = "completed"
        _jobs[job_id]["matches"] = all_matches
        _jobs[job_id]["match_count"] = len(all_matches)
    except Exception as e:
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(e)


def _update_progress(job_id: str, frames_processed: int, frames_matched: int):
    """Called by AI pipelines to report incremental progress."""
    if job_id in _jobs:
        _jobs[job_id]["frames_processed"] = frames_processed
        _jobs[job_id]["frames_matched"] = frames_matched


def _run_keyword_search_task(job_id: str, request: KeywordSearchRequest):
    """Background task for keyword search."""
    from ai_pipeline.keyword_search import run_keyword_search  # noqa: PLC0415

    _jobs[job_id]["status"] = "running"
    _jobs[job_id]["started_at"] = time.time()
    all_matches = []

    try:
        for vid_id in request.video_ids:
            # Timeout guard
            if time.time() - _jobs[job_id]["started_at"] > JOB_TIMEOUT_SECONDS:
                raise TimeoutError("Job exceeded maximum allowed runtime")

            video_path, meta = _resolve_video(vid_id)
            sub_job_id = f"{job_id}_{vid_id}"
            matches = run_keyword_search(
                video_path=video_path,
                keyword=request.keyword,
                camera_id=meta.get("camera_id", "CAM-01"),
                similarity_threshold=request.similarity_threshold,
                sample_fps=request.sample_fps,
                job_id=sub_job_id,
                start_time=request.start_time,
                end_time=request.end_time,
                progress_cb=lambda p, m: _update_progress(job_id, p, m),
            )
            all_matches.extend(matches)

        _jobs[job_id]["status"] = "completed"
        _jobs[job_id]["matches"] = all_matches
        _jobs[job_id]["match_count"] = len(all_matches)
    except Exception as e:
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(e)


def _run_lpr_search_task(job_id: str, request: LprSearchRequest):
    """Background task for license plate search."""
    from ai_pipeline.lpr_search import run_lpr_search  # noqa: PLC0415

    _jobs[job_id]["status"] = "running"
    _jobs[job_id]["started_at"] = time.time()
    all_matches = []

    try:
        for vid_id in request.video_ids:
            # Timeout guard
            if time.time() - _jobs[job_id]["started_at"] > JOB_TIMEOUT_SECONDS:
                raise TimeoutError("Job exceeded maximum allowed runtime")

            video_path, meta = _resolve_video(vid_id)
            sub_job_id = f"{job_id}_{vid_id}"
            matches = run_lpr_search(
                video_path=video_path,
                plate_text=request.plate_text,
                camera_id=meta.get("camera_id", "CAM-01"),
                similarity_threshold=request.similarity_threshold,
                sample_fps=request.sample_fps,
                job_id=sub_job_id,
                start_time=request.start_time,
                end_time=request.end_time,
                progress_cb=lambda p, m: _update_progress(job_id, p, m),
            )
            all_matches.extend(matches)

        _jobs[job_id]["status"] = "completed"
        _jobs[job_id]["matches"] = all_matches
        _jobs[job_id]["match_count"] = len(all_matches)
    except Exception as e:
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(e)


@router.post("/by-image")
def search_by_image(request: ImageSearchRequest, background_tasks: BackgroundTasks):
    """Start a face recognition search job. Returns a job_id to poll for status."""
    job_id = str(uuid.uuid4())[:8]
    _jobs[job_id] = {"status": "queued", "type": "face_recognition", "matches": [], "match_count": 0,
                     "frames_processed": 0, "frames_matched": 0}
    background_tasks.add_task(_run_face_search_task, job_id, request)
    return {"job_id": job_id, "status": "queued"}


@router.post("/by-keyword")
def search_by_keyword(request: KeywordSearchRequest, background_tasks: BackgroundTasks):
    """Start a keyword search job. Returns a job_id to poll for status."""
    job_id = str(uuid.uuid4())[:8]
    _jobs[job_id] = {"status": "queued", "type": "keyword", "matches": [], "match_count": 0,
                     "frames_processed": 0, "frames_matched": 0}
    background_tasks.add_task(_run_keyword_search_task, job_id, request)
    return {"job_id": job_id, "status": "queued"}


@router.post("/by-lpr")
def search_by_lpr(request: LprSearchRequest, background_tasks: BackgroundTasks):
    """Start a license plate recognition search job. Returns a job_id to poll for status."""
    job_id = str(uuid.uuid4())[:8]
    _jobs[job_id] = {"status": "queued", "type": "lpr", "matches": [], "match_count": 0,
                     "frames_processed": 0, "frames_matched": 0}
    background_tasks.add_task(_run_lpr_search_task, job_id, request)
    return {"job_id": job_id, "status": "queued"}


@router.get("/job/{job_id}")
def get_job_status(job_id: str):
    """Poll job status and retrieve results when complete."""
    if job_id not in _jobs:
        # Check subdirectories of RESULTS_DIR for manifest.json files that match this job ID
        all_matches = []
        search_type = "unknown"
        has_manifest = False
        
        # Check single-video folder
        manifest_file = RESULTS_DIR / job_id / "manifest.json"
        if manifest_file.exists():
            try:
                manifest = json.loads(manifest_file.read_text())
                all_matches.extend(manifest.get("matches", []))
                search_type = manifest.get("search_type", "unknown")
                has_manifest = True
            except Exception:
                pass
        else:
            # Check multi-video folder prefixes (e.g. jobid_cam01, jobid_cam02)
            for sub_dir in RESULTS_DIR.iterdir():
                if sub_dir.is_dir() and sub_dir.name.startswith(job_id):
                    sub_manifest = sub_dir / "manifest.json"
                    if sub_manifest.exists():
                        try:
                            manifest = json.loads(sub_manifest.read_text())
                            all_matches.extend(manifest.get("matches", []))
                            search_type = manifest.get("search_type", "unknown")
                            has_manifest = True
                        except Exception:
                            pass
                            
        if has_manifest:
            _jobs[job_id] = {
                "status": "completed",
                "type": search_type,
                "matches": all_matches,
                "match_count": len(all_matches),
            }

    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return _jobs[job_id]


@router.get("/jobs")
def list_jobs():
    """List all search jobs in this session."""
    return {"jobs": {k: {kk: vv for kk, vv in v.items() if kk != "matches"} for k, v in _jobs.items()}}
