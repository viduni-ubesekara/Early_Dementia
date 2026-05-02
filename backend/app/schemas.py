from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class MedicalPayload(BaseModel):
    dementia_history: int = 0
    stroke_history: int = 0
    Parkinsons: int = 0
    diabetes: int = 0
    hypertension: int = 0
    depression: int = 0
    anxiety: int = 0  # explicit anxiety flag, used by insight engine
    medication_load: int = 0
    MMSE_previous_score: float = 28.0
    MMSE_decline_rate: float = 0.1
    physician_rating: int = Field(2, ge=1, le=4)
    confusion_reported: int = 0
    memory_loss_reported: int = 0
    hippocampal_volume: float = 4000.0
    brain_atrophy_level: float = 0.0
    cortical_thickness: float = 2.4
    lesion_score: float = 0.0
    Alzheimer_pattern_detected: int = 0
    # Optional clinical demographics used for normative adjustment
    # (Crum 1993 MMSE norms; Salthouse 1996 RT norms).
    age: Optional[float] = Field(None, ge=0, le=120)
    education_years: Optional[float] = Field(None, ge=0, le=30)


class SessionPayload(BaseModel):
    orientation_score: float = Field(..., ge=0, le=20)
    memory_score: float = Field(..., ge=0, le=20)
    attention_score: float = Field(..., ge=0, le=20)
    language_score: float = Field(..., ge=0, le=20)
    visual_spatial_score: float = Field(..., ge=0, le=20)
    reaction_time_avg: float = Field(1.0, gt=0)
    accuracy_rate: float = Field(0.9, ge=0, le=1)
    hesitation_time: float = 5.0
    error_count: int = Field(0, ge=0)
    completion_time: float = Field(90.0, gt=0)


class PredictRequest(BaseModel):
    session: SessionPayload
    medical: MedicalPayload
    model_name: Literal["random_forest", "xgboost", "logistic_regression"] = "random_forest"
    store_session: bool = False
    display_name: Optional[str] = None


# ===== Phase-based session schemas =====


class StartSessionRequest(BaseModel):
    display_name: Optional[str] = None


class StartSessionResponse(BaseModel):
    sessionId: str
    createdAt: str


class CognitiveAnswer(BaseModel):
    questionId: int
    domain: Literal["orientation", "memory", "attention", "language", "visual_spatial"]
    points: float = Field(..., ge=0)
    max_points: float = Field(10.0, gt=0)
    correct: Optional[bool] = None


class BehavioralLog(BaseModel):
    questionId: int
    reaction_time_ms: float = Field(..., ge=0)
    attempts: int = Field(1, ge=0)
    delay_ms: float = Field(0.0, ge=0)
    hesitation_ms: float = Field(0.0, ge=0)
    correct: Optional[bool] = None


class FacialFrame(BaseModel):
    emotion: Optional[str] = None
    timestamp: Optional[str] = None
    confusion_score: Optional[float] = Field(None, ge=0, le=100)
    questionId: Optional[int] = None


class SpeechSample(BaseModel):
    """
    Per-task speech capture sample.

    Pre-clinical-validation fields:
        transcript, hesitation_count, sentiment_score, clarity_score, questionId.

    Connected-speech upgrades (Boschi 2017 / Fraser 2016 / Forbes-McKay 2005):
        word_count, unique_word_count, type_token_ratio, mean_length_of_utterance,
        repetition_rate, sentence_complexity, words_per_minute, duration_sec,
        pause_total_ms, long_pause_count, plus three boolean flags surfaced by
        the frontend analyser to make downstream rule logic easier.
    """

    transcript: Optional[str] = None
    hesitation_count: Optional[int] = None
    sentiment_score: Optional[float] = None
    clarity_score: Optional[float] = None
    questionId: Optional[int] = None

    # connected-speech feature upgrades
    word_count: Optional[int] = None
    unique_word_count: Optional[int] = None
    type_token_ratio: Optional[float] = None
    mean_length_of_utterance: Optional[float] = None
    repetition_rate: Optional[float] = None
    sentence_complexity: Optional[float] = None
    words_per_minute: Optional[float] = None
    duration_sec: Optional[float] = None
    pause_total_ms: Optional[float] = None
    long_pause_count: Optional[int] = None
    unique_animals: Optional[int] = None  # verbal-fluency only

    # convenience flags for the insight engine
    cognitive_slowdown_flag: Optional[bool] = None
    excessive_repetition_flag: Optional[bool] = None
    excessive_hesitation_flag: Optional[bool] = None

    model_config = {"extra": "ignore"}


class TurnSpeechAnalysis(BaseModel):
    """Per-turn browser speech features (Web Speech + client-side NLP)."""

    words_per_minute: Optional[float] = None
    duration_sec: Optional[float] = None
    pause_total_ms: Optional[float] = None
    long_pause_count: Optional[int] = None
    hesitation_count: Optional[int] = None
    repetition_rate: Optional[float] = None
    clarity_score: Optional[float] = None
    sentence_complexity: Optional[float] = None
    cognitive_slowdown_flag: Optional[bool] = None
    excessive_repetition_flag: Optional[bool] = None
    excessive_hesitation_flag: Optional[bool] = None

    model_config = {"extra": "ignore"}


class ConversationTurnModel(BaseModel):
    role: Literal["assistant", "user"]
    text: str = Field(default="", max_length=12000)
    stepId: Optional[str] = Field(None, max_length=64)
    durationSec: Optional[float] = Field(None, ge=0, le=7200)
    speech_analysis: Optional[TurnSpeechAnalysis] = None


class ConversationAgentPayload(BaseModel):
    """Natural-dialogue transcript from the Conversational Cognitive Assessment Agent."""

    turns: list[ConversationTurnModel] = Field(default_factory=list)
    locale: Optional[str] = Field("en", max_length=16)
    variant: Optional[str] = Field(None, max_length=32)
    input_mode: Optional[str] = Field(
        None,
        max_length=32,
        description="e.g. microphone_only — how user turns were captured",
    )
    startedAt: Optional[str] = None
    endedAt: Optional[str] = None

    model_config = {"extra": "ignore"}


class RecordBehaviorRequest(BaseModel):
    sessionId: str
    cognitive_answer: Optional[CognitiveAnswer] = None
    behavioral_log: Optional[BehavioralLog] = None
    facial_frame: Optional[FacialFrame] = None
    speech_sample: Optional[SpeechSample] = None
    conversation_agent: Optional[ConversationAgentPayload] = None
    medical_partial: Optional[dict[str, Any]] = None


class CompleteAssessmentRequest(BaseModel):
    sessionId: str
    medical: MedicalPayload
    model_name: Literal["random_forest", "xgboost", "logistic_regression"] = "random_forest"
    completion_time_s: Optional[float] = None
    total_questions: Optional[int] = None
    persist: bool = False
