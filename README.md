# Cognitive Screening & Dementia Risk — Multi-Modal Fusion (Research Prototype)

**Decision-support only.** All data are **synthetic**. This is **not** a medical device and does **not** provide a diagnosis.

See **[CLINICAL_VALIDATION.md](CLINICAL_VALIDATION.md)** for the full literature-grounded justification of every weight, threshold, and formula in the system, plus a roadmap of what is still required for actual clinical validation.

## Fusion (clinical-validated weights)

- **Final score:** \(S = 0.40\,C + 0.15\,B + 0.20\,P + 0.25\,(100-M)\)
  - Cognition (`C`) keeps clinical primacy (NIA-AA 2018 / IWG-2)
  - Medical (`M`) is now imaging-dominant and correctly *lowers* `S` for sicker patients (sign-correction)
  - Performance (`P`) uses age-normed reaction time (Salthouse 1996, Deary 2010)
  - Behavior (`B`) is bug-fixed (no more 39 floor) and decoupled from RT
- **Medical sub-fusion:** \(M = 0.20\,H + 0.30\,R + 0.50\,I\) — imaging-dominant per Frisoni 2010 / NIA-AA 2018.
- **Cognition `C`** uses domain weights `{memory: 0.30, orientation: 0.20, attention: 0.20, language: 0.15, visuospatial: 0.15}` (Petersen 2004 / Albert 2011) and Crum-1993 age + education adjustment.
- **Rule-based class** from \(S\): Normal (≥78), MCI (65–77), Moderate (50–64), Severe (<50), with a **±3 indeterminate buffer** at every boundary that routes border cases to clinician review (Van Calster 2019).
- **Calibrated probabilities** via `CalibratedClassifierCV` (isotonic, cv=3) on every fusion classifier.

## Two-phase data flow

- **Phase 1 — real-time capture** (during the test):
  per-question reaction time, attempts, delay, hesitation; webcam-driven facial
  confusion frames; optional Web-Speech-API transcript with clarity + sentiment.
  These are streamed to `POST /api/record-behavior` against an active session.
- **Phase 2 — post-task computation** (after the test):
  C from cognitive answers, P from reaction + accuracy, B = 0.4·reaction +
  0.3·facial + 0.3·speech, M from the medical ML model. Then S, classification,
  and per-class probabilities.

Endpoints:

- `POST /api/start-session` → `{ sessionId, createdAt }`
- `POST /api/record-behavior` → append a `cognitive_answer`, `behavioral_log`,
  `facial_frame`, or `speech_sample` to the session
- `POST /api/complete-assessment` → returns `{ final_score, risk_level, scores: {C,B,P,M}, medical: {H,R,I}, ... }`
- Legacy single-shot `POST /api/predict` is preserved for backward compatibility.

## Models

1. **Medical risk score \(M\):** Random Forest regressor on tabular medical/imaging features (XGBoost regressor is trained in the same script for MAE comparison).
2. **Fusion classifiers** on \((C,B,P,M)\): Random Forest (primary), XGBoost, Logistic regression (baseline).

## Quick start

```bash
cd Viduni
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt

python -m backend.scripts.generate_datasets
python -m backend.ml.train_all
python -m backend.ml.evaluate
```

**API (FastAPI):**

```bash
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` for Swagger.

**React UI:**

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` to port 8000. Complete the MMSE-style flow, then open **Results** for \(S\), C/B/P/M, class probabilities, and panel metrics (if the API is up).

## MRI slice → medical form (optional)

The UI can upload a **2D brain MRI slice** (PNG/JPEG) on the medical form. The API endpoint is `POST /api/analyze-mri-image` (multipart file field `file`).

1. Train and export **`best_mri_model.keras`** with `data/MRI_Data_set/MRI Model.ipynb` (Colab).
2. Copy it to **`backend/ml_artifacts/best_mri_model.keras`** (or set env **`MRI_MODEL_PATH`**).
3. Install TensorFlow for inference: `pip install -r requirements-mri.txt`

Without the weights file the service uses an **image-statistics fallback** (demo only). Single-slice inference cannot produce true mm³ or Fazekas scores — it maps the 4-class severity head to **proxy values** for hippocampal volume, atrophy level, cortical thickness, lesion score, physician rating, and the Alzheimer-pattern flag so they stay consistent with the rest of the pipeline. Chart-only fields (MMSE, medication load, etc.) are not guessed from imaging.

## Optional MongoDB

Set `MONGO_URI` (and optional `MONGO_DB`). In `POST /api/predict`, set `"store_session": true` to log the synthetic request and result in MongoDB (optional).

## Artifacts

| Path | Purpose |
|------|---------|
| `data/medical.csv`, `data/cognitive_session.csv`, `data/fusion.csv` | Generated tabular datasets |
| `models/*.joblib` | Trained regressor and fusion classifiers |
| `reports/full_metrics.json` | Accuracy, P/R/F1, confusion, ROC AUC, etc. |
| `reports/roc_*.png` | ROC curves (OvR) per model |
| `backend/ml_artifacts/best_mri_model.keras` | Optional MobileNetV2 slice classifier for `/api/analyze-mri-image` |

## Viva / explainability

- **C, B, P** are defined in `backend/data_generation/fusion_formulas.py` with transparent formulas.
- **M** is **predicted** by ML from the medical table (not hand-set at inference), matching the “ML-based medical score” requirement.
- **Model confidence** and **per-class probabilities** come from the selected fusion classifier’s `predict_proba`, aligned to four risk classes.
