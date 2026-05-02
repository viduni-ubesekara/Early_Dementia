"""
Lightweight in-memory session store for the two-phase flow.
Optionally mirrors writes to MongoDB if MONGO_URI is set.
"""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.app.config import MONGO_DB, MONGO_URI

_LOCK = threading.RLock()
_SESSIONS: dict[str, dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _maybe_mongo_upsert(doc: dict[str, Any]) -> None:
    if not MONGO_URI:
        return
    try:
        from pymongo import MongoClient

        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
        client.server_info()
        client[MONGO_DB]["synthetic_sessions"].replace_one(
            {"_id": doc["sessionId"]}, doc, upsert=True
        )
    except Exception:
        pass


def create_session(display_name: str | None = None) -> dict[str, Any]:
    sid = str(uuid.uuid4())
    doc: dict[str, Any] = {
        "sessionId": sid,
        "createdAt": _now_iso(),
        "displayName": display_name,
        "cognitiveAnswers": [],
        "behavioralLogs": [],
        "facialData": [],
        "speechData": [],
        "conversationAgent": None,
        "medicalData": {},
        "phase1_complete": False,
        "phase2_complete": False,
    }
    with _LOCK:
        _SESSIONS[sid] = doc
    _maybe_mongo_upsert(doc)
    return doc


def get_session(sid: str) -> dict[str, Any] | None:
    with _LOCK:
        return _SESSIONS.get(sid)


def append_behavior(
    sid: str,
    *,
    cognitive_answer: dict[str, Any] | None = None,
    behavioral_log: dict[str, Any] | None = None,
    facial_frame: dict[str, Any] | None = None,
    speech_sample: dict[str, Any] | None = None,
    conversation_agent: dict[str, Any] | None = None,
    medical_partial: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with _LOCK:
        s = _SESSIONS.get(sid)
        if s is None:
            raise KeyError(f"Unknown session {sid}")
        if cognitive_answer is not None:
            s["cognitiveAnswers"].append(cognitive_answer)
        if behavioral_log is not None:
            s["behavioralLogs"].append(behavioral_log)
        if facial_frame is not None:
            s["facialData"].append(facial_frame)
        if speech_sample is not None:
            s["speechData"].append(speech_sample)
        if conversation_agent is not None:
            s["conversationAgent"] = conversation_agent
        if medical_partial is not None:
            s["medicalData"].update(medical_partial)
        s["updatedAt"] = _now_iso()
        snapshot = dict(s)
    _maybe_mongo_upsert(snapshot)
    return snapshot


def mark_complete(sid: str, phase: int = 2, result: dict[str, Any] | None = None) -> None:
    with _LOCK:
        s = _SESSIONS.get(sid)
        if s is None:
            return
        if phase >= 1:
            s["phase1_complete"] = True
        if phase >= 2:
            s["phase2_complete"] = True
        if result is not None:
            s["result"] = result
        s["completedAt"] = _now_iso()
        snapshot = dict(s)
    _maybe_mongo_upsert(snapshot)
