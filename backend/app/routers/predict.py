from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from backend.app.config import MONGO_DB, MONGO_URI, REPORT_DIR, ROOT
from backend.app.schemas import PredictRequest
from backend.app.services.inference import run_full_assessment

router = APIRouter(prefix="/api", tags=["predict"])


def _optional_store_doc(doc: dict) -> None:
    if not MONGO_URI:
        return
    try:
        from pymongo import MongoClient

        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
        client.server_info()
        client[MONGO_DB]["synthetic_sessions"].insert_one(doc)
    except Exception:
        pass


@router.post("/predict")
def predict_post(body: PredictRequest) -> dict[str, Any]:
    med = body.medical.model_dump()
    sess = body.session.model_dump()
    try:
        out = run_full_assessment(
            **sess,
            medical=med,
            model_name=body.model_name,
        )
    except FileNotFoundError as e:
        raise HTTPException(503, "Models not found. Run training pipeline first.") from e
    out["model_used"] = body.model_name
    out["disclaimer"] = (
        "Research prototype. Synthetic-only training. Not a medical device or diagnosis."
    )
    if body.store_session and MONGO_URI:
        _optional_store_doc(
            {
                "_id": str(uuid.uuid4()),
                "ts": datetime.now(timezone.utc).isoformat(),
                "display_name": body.display_name,
                "request": body.model_dump(),
                "result": out,
            }
        )
    return out


@router.get("/metrics")
def get_metrics() -> Any:
    import json

    p = os.path.join(REPORT_DIR, "full_metrics.json")
    if not os.path.exists(p):
        raise HTTPException(404, "No evaluation report. Train models first.")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


@router.get("/health")
def health() -> dict[str, str]:
    models_ok = os.path.exists(
        os.path.join(ROOT, "models", "medical_regressor.joblib")
    )
    return {
        "status": "ok",
        "models_loaded_path": "models" if models_ok else "missing",
    }
