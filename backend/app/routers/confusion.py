"""Webcam JPEG frame -> confusion score (YOLOv8 when weights present)."""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.app.services.confusion_yolo import MAX_FRAME_BYTES, analyze_confusion_frame_bytes

router = APIRouter(prefix="/api", tags=["confusion"])


@router.post("/analyze-confusion-frame")
async def analyze_confusion_frame(file: UploadFile = File(...)) -> dict:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Upload an image (JPEG or PNG).")
    data = await file.read()
    if len(data) > MAX_FRAME_BYTES:
        raise HTTPException(413, f"Frame too large (max {MAX_FRAME_BYTES // (1024 * 1024)} MB).")
    try:
        out = analyze_confusion_frame_bytes(data)
        if out.get("method") == "unavailable":
            raise HTTPException(503, out.get("note") or "Confusion model not loaded.")
        return out
    except ValueError as e:
        if str(e) == "file_too_large":
            raise HTTPException(413, "Frame too large.") from e
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Could not analyze frame: {e}") from e
