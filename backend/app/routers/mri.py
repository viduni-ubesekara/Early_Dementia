"""MRI slice upload — fills imaging-related medical form fields (proxies)."""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.app.services.mri_slice_analysis import MAX_UPLOAD_BYTES, analyze_mri_image_bytes

router = APIRouter(prefix="/api", tags=["mri"])


@router.post("/analyze-mri-image")
async def analyze_mri_image(file: UploadFile = File(...)) -> dict:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Upload an image file (PNG, JPEG, or WebP).")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Image too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).")
    try:
        return analyze_mri_image_bytes(data)
    except ValueError as e:
        if str(e) == "file_too_large":
            raise HTTPException(413, "Image too large.") from e
        raise HTTPException(400, f"Could not read image: {e}") from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Could not analyze image: {e}") from e
