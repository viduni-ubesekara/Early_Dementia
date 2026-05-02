"""Phase-based session endpoints: /start-session, /record-behavior, /complete-assessment."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.app.schemas import (
    CompleteAssessmentRequest,
    RecordBehaviorRequest,
    StartSessionRequest,
    StartSessionResponse,
)
from backend.app.services.inference import run_phase2_assessment
from backend.app.services.session_store import (
    append_behavior,
    create_session,
    get_session,
    mark_complete,
)

router = APIRouter(prefix="/api", tags=["session"])


@router.post("/start-session", response_model=StartSessionResponse)
def start_session(body: StartSessionRequest) -> StartSessionResponse:
    s = create_session(display_name=body.display_name)
    return StartSessionResponse(sessionId=s["sessionId"], createdAt=s["createdAt"])


@router.post("/record-behavior")
def record_behavior(body: RecordBehaviorRequest) -> dict:
    if not get_session(body.sessionId):
        raise HTTPException(404, "Unknown sessionId. Call /api/start-session first.")
    snapshot = append_behavior(
        body.sessionId,
        cognitive_answer=body.cognitive_answer.model_dump() if body.cognitive_answer else None,
        behavioral_log=body.behavioral_log.model_dump() if body.behavioral_log else None,
        facial_frame=body.facial_frame.model_dump() if body.facial_frame else None,
        speech_sample=body.speech_sample.model_dump() if body.speech_sample else None,
        conversation_agent=body.conversation_agent.model_dump() if body.conversation_agent else None,
        medical_partial=body.medical_partial,
    )
    return {
        "ok": True,
        "sessionId": body.sessionId,
        "counts": {
            "cognitiveAnswers": len(snapshot["cognitiveAnswers"]),
            "behavioralLogs": len(snapshot["behavioralLogs"]),
            "facialData": len(snapshot["facialData"]),
            "speechData": len(snapshot["speechData"]),
            "hasConversationAgent": snapshot.get("conversationAgent") is not None,
        },
    }


@router.get("/session/{sid}")
def read_session(sid: str) -> dict:
    s = get_session(sid)
    if not s:
        raise HTTPException(404, "session not found")
    return s


@router.post("/complete-assessment")
def complete_assessment(body: CompleteAssessmentRequest) -> dict:
    s = get_session(body.sessionId)
    if not s:
        raise HTTPException(404, "Unknown sessionId. Call /api/start-session first.")

    medical_payload = {**(s.get("medicalData") or {}), **body.medical.model_dump()}
    try:
        result = run_phase2_assessment(
            cognitive_answers=s["cognitiveAnswers"],
            behavioral_logs=s["behavioralLogs"],
            facial_data=s["facialData"],
            speech_data=s["speechData"],
            medical=medical_payload,
            model_name=body.model_name,
            completion_time_s=body.completion_time_s,
            total_questions=body.total_questions or len(s["cognitiveAnswers"]) or None,
            conversation_agent=s.get("conversationAgent"),
        )
    except FileNotFoundError as e:
        raise HTTPException(503, "Models not found. Run training pipeline first.") from e

    result["sessionId"] = body.sessionId
    if not body.persist:
        # in-memory only by default
        pass
    mark_complete(body.sessionId, phase=2, result=result)
    return result
