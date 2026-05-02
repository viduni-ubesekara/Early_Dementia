# Clinical Validation Notes

**Status: research prototype, synthetic-only training. NOT a medical device.**
This document is a transparent record of every constant, weight, threshold,
and design choice in the system, with the published reference that justifies
it. It is intended as the *clinical-evidence backbone* of the prototype, and
as the artifact a regulatory reviewer would expect to see at the start of a
real validation study.

---

## 1. Scope and intent

- **Intent**: a multi-modal screening *adjunct* that combines a brief
  cognitive test (MMSE-style), behavioral telemetry (reaction time,
  hesitation, facial expression, speech), and a tabular medical /
  imaging panel into a single 0–100 cognitive-risk score `S` and a
  four-tier label (`Normal`, `MCI`, `Moderate`, `Severe`).
- **Use case envisaged**: a primary-care screening tool that flags
  patients who should be referred for a full neuropsychological battery
  (MoCA, ACE-III, CDR), *not* a diagnostic tool.
- **What this document does**: anchors every numeric choice to a
  published reference and lists what is still required for real
  clinical validation.

---

## 2. Top-level fusion

```
S = wC * C + wB * B + wP * P + wM * (100 − M)
```

Channel weights (`backend/data_generation/fusion_formulas.py`,
constants `W_C`, `W_B`, `W_P`, `W_M`):

| Symbol | Weight | Rationale |
|--------|-------:|-----------|
| `wC` | **0.40** | Cognitive screens (MMSE / MoCA) are the front-line test in every modern dementia diagnostic pathway: NIA-AA 2011 MCI criteria (Albert et al. 2011), NIA-AA 2018 research framework (Jack et al. 2018), IWG-2 (Dubois et al. 2014). |
| `wM` | **0.25** | NIA-AA 2018 places imaging biomarkers at the *top* of the diagnostic hierarchy (the 'I' channel inside `M`). Frisoni et al. 2010 (Nat Rev Neurol 6:67) review structural MRI in AD and report sensitivity ≥ 80 % for hippocampal-volume readings. Raised from the original 0.15 because the sign-correction (see §6) finally allows the medical channel to contribute to discrimination instead of opposing it. |
| `wP` | **0.20** | Performance (accuracy + age-normed RT) is the strongest single behavioral predictor of MCI/AD: Phillips et al. 2013 (Neuropsychologia 51:13). |
| `wB` | **0.15** | Behavior (facial / speech / hesitation) is the most heuristic channel. The 0.15 weight prevents a noisy webcam or microphone from swinging the diagnosis. |

The weights sum to 1.0 and are asserted at module import time.

**M-sign correction (critical fix).** The original formula added `M`
as a positive term. But `M` is reported as a *risk* score (high =
sicker), whereas C / B / P are *health* scores (high = healthier). So
in the original code, a sicker patient's high `M` slightly *raised*
`S` (which means "Normal"), wasting the medical signal. The new
`compute_S` uses `(100 − M)` internally so the medical channel
correctly *lowers* `S` for patients with imaging or history burden.
External reporting still surfaces `M` as a risk score for clinical
readability.

**Learned weights (synthetic-label sanity check).** L1-regularised
multinomial logistic regression on `(C, B, P, M)` recovers
`[0.115, 0.131, 0.251, 0.503]` from the synthetic labels (see
`reports/full_metrics.json → learned_fusion_weights`). The model agrees
that `M` is the highest-information channel, which is consistent with
the imaging-dominant clinical literature, but heavily de-emphasises
`C`. We keep the literature-justified defaults until labelled real
cohort data is available, because the synthetic labels are themselves a
*linear* function of `(C, B, P, M)`, which biases the learned weights
toward whichever channel carries the most variance in the synthetic
generator (here, `M`). This is exactly the label-leakage warning in §10.

---

## 3. Cognition `C` — domain-weighted, age- and education-adjusted

### 3.1 Domain weights

```
C = 100 × Σ wᵈ · (raw_d / 20)        for d ∈ {memory, orientation, attention, language, visuospatial}
```

| Domain | Weight |
|--------|-------:|
| Memory | **0.30** |
| Orientation | 0.20 |
| Attention | 0.20 |
| Language | 0.15 |
| Visuospatial | 0.15 |

Memory is up-weighted because:

- Petersen 2004 (J Intern Med 256:183) defines amnestic MCI as the
  highest-risk subtype for AD conversion.
- Albert et al. 2011 NIA-AA MCI criteria require objective memory
  impairment as the primary inclusion criterion.
- IRT analyses of MMSE items (Tombaugh & McIntyre 1992, JAGS 40:922;
  Crum et al. 1993, JAMA 269:2386) report 2–3× higher item
  discrimination for delayed-recall items than for orientation items.

### 3.2 Age and education adjustment

Following Crum et al. 1993 *Population-based norms for the MMSE by
age and educational level* (JAMA 269:2386), the raw `C` is adjusted:

```
adj  = +2.0 if education_years < 9
adj  = −1.0 if education_years > 12
adj += +1.0 if age ≥ 75
adj += +2.0 if age ≥ 85
```

This avoids the well-documented MMSE bias against less-educated and
very elderly patients.

### 3.3 Backward compatibility

`compute_C(...)` (the original, unweighted, unadjusted version) is
retained verbatim so any older caller or saved dataset keeps working.
New code paths in `inference.py` always use `compute_C_weighted`.

---

## 4. Performance `P` — age-normed reaction time

```
P = 0.6 · accuracy(0..100) + 0.4 · speed(rt, age)
speed(rt, age) = 100 / (1 + exp((rt − rt_norm(age)) / 0.45))
```

Normative reaction times (`NORM_RT_BY_AGE`):

| Age band | rt_norm (s) |
|----------|------------:|
| < 40   | 0.95 |
| 40–60  | 1.10 |
| 60–70  | 1.35 |
| 70–80  | 1.55 |
| 80+    | 1.80 |

**Why the change matters.** The original formula
`120 / (1 + rt^1.2)` mapped a perfectly normal 2-second response from
a 75-year-old to a *speed score of 36/100* — silently penalising the
patient for being old. That single curve was the primary cause of the
TC-01 (anxious-but-cognitively-fine) false-positive MCI flag.

References:

- Salthouse 1996 *The processing-speed theory of adult age differences
  in cognition* (Psychol Rev 103:403)
- Deary, Liewald & Nissan 2010 *Reaction times and intelligence
  differences* (Neurosci Biobehav Rev 34:1029)
- Hultsch et al. 2002 *Variability in reaction time performance of
  younger and older adults* (J Gerontol B Psychol Sci 57:101)
- Phillips et al. 2013 *Reaction time and cognition in MCI/AD*
  (Neuropsychologia 51:13)

---

## 5. Behavior `B` — bug-fixed and decoupled from RT

### 5.1 Floor bug (original code)

In the original `compute_B`, the maximum penalty was capped at
`error*40 + hesitation*0.35*35 + delay*0.25*35 = 61`, so `B` could
never drop below 39 even for a maximally impaired patient. With the
new fusion weights, that floor would have made it impossible for any
patient to land in the `Severe` band purely on behavioral evidence.

### 5.2 New formula

```
err_n  = errors / n_questions                   ∈ [0, 1]
hes_n  = min(1, hesitation_time / 30 s)         ∈ [0, 1]
del_n  = min(1, max(0, completion − 90) / 120)  ∈ [0, 1]
B = 100 × (1 − (0.50·err_n + 0.30·hes_n + 0.20·del_n))
```

`B` now correctly ranges over the full 0..100. Errors get the largest
weight (0.50) because error count is the strongest behavioral marker
of cognitive failure (it is what the MMSE itself scores).

### 5.3 RT decoupling

Per-question reaction time is **no longer** included in `B`. RT is
captured exclusively by `P` (speed score). This removes the earlier
double-counting where RT contributed to *both* P and B, effectively
inflating its weight in the fused S to ~0.45 instead of the intended
0.20.

### 5.4 Phase-2 `B` (real-time signals)

Phase-2 uses three sub-scores (`reaction_behavior`, `facial_score`,
`speech_score`) combined with weights `0.45 / 0.25 / 0.30` (or
`0.55 / 0.45` if the browser does not expose Web Speech API, so the
patient is not penalised for a *device* limitation). All three
sub-scores are 0..100 so `B` correctly spans the full range.

---

## 6. Medical sub-fusion `M = wH·H + wR·R + wI·I`

Old equal weights `0.33 / 0.33 / 0.34` were clinically wrong: they
rated a self-reported family-history flag the same as a hippocampal
atrophy reading. New weights:

| Sub-score | Weight | Source |
|-----------|-------:|--------|
| `H` (history)  | **0.20** | Risk modifier, not a diagnostic finding (Albert 2011). |
| `R` (reports) | **0.30** | Prior MMSE, decline rate, physician rating, carer-reported confusion (Mitchell 2009 *A meta-analysis of the accuracy of the MMSE in the detection of dementia and MCI*, J Psychiatr Res 43:411). |
| `I` (imaging) | **0.50** | NIA-AA 2018 places imaging biomarkers at the top of the diagnostic hierarchy (Jack et al. 2018, Alzheimers Dement 14:535). Frisoni et al. 2010 (Nat Rev Neurol 6:67) reports MRI sensitivity ≥ 80 % for AD when hippocampal atrophy / cortical-thinning patterns are present. |

The legacy equal-weight version `medical_subfusion_legacy` is kept
only to reproduce the older synthetic dataset.

---

## 7. Risk bands and *indeterminate* zone

Tier bands (`RISK_BINS`):

| Band | S range |
|------|---------|
| Normal | ≥ 78 |
| MCI | 65 – 78 |
| Moderate | 50 – 65 |
| Severe | < 50 |

The 78 / 65 / 50 cutoffs are inherited from the original prototype.
For real validation they must be re-derived as ROC-optimal cutoffs at
a target sensitivity (e.g. 90 %) on a labelled cohort — see §10.

**Indeterminate zone.** A buffer of `± 3.0` around each tier boundary
plus a *low confidence* trigger (calibrated probability < 0.65) routes
the patient to an explicit `"Indeterminate"` block instead of a
confident class.

```
if |S − 78| < 3 OR |S − 65| < 3 OR |S − 50| < 3:
    indeterminate = True
if model_confidence < 0.65:
    indeterminate = True
```

The `Indeterminate` insight tells the clinician the patient sits on
a tier boundary and recommends re-testing rather than acting on a
single borderline result. This is the single most important clinical
safety mechanism in the system. Reference: Van Calster et al. 2019
*Calibration: the Achilles heel of predictive analytics*, BMC
Medicine 17:230.

This directly fixes the false-positive surfaced in the original test
case TC-01 (anxious-but-cognitively-fine), which used to land at
`S=76.76` and be hard-classified as `MCI` despite zero medical
evidence of impairment.

---

## 8. Behavioral channel — `B` sub-scores and constants

### 8.1 Emotion → confusion mapping

`backend/app/services/behavior_aggregation.py → EMOTION_TO_CONFUSION`.

The dictionary keys are the standard Ekman 1992 (Cogn Emot 6:169) basic
emotions plus `confused / frustrated / focused / calm`, matching the
labels emitted by every off-the-shelf face-expression classifier.

The numeric values are the median rank-order ascribed to each label as
a *task confusion* proxy in:

- Mollahosseini, Hasani & Mahoor 2017 *AffectNet*
  (IEEE TAffectiveComputing 10:18) — affective valence/arousal labels.
- Henry et al. 2008 *A meta-analytic review of emotion recognition in
  dementia* (Neuropsychologia 46:2855).
- Burton et al. 2008 *Cognitive load and facial expression* — link
  between confused / frustrated expressions and task demand.

### 8.2 Speech features

Replaced the 1990s-era filler-word heuristic with four markers from
the connected-speech literature:

1. Filler-token ratio (`um`, `uh`, ...) — Clark & Fox Tree 2002
   *Using uh and um in spontaneous speaking* (Cognition 84:73).
2. Type-token ratio (lexical impoverishment) — Fraser, Meltzer &
   Rudzicz 2016 *Linguistic features identify Alzheimer's disease in
   narrative speech* (J Alzheimers Dis 49:407).
3. Mean length of utterance — Boschi et al. 2017 *Connected speech in
   neurodegenerative language disorders: a review* (Front Psychol 8:269).
4. Sentiment balance from positive / negative lexicons (placeholder
   for a transformer-based sentiment model — see §10).

Speech-quality score:
`0.40·clarity + 0.25·TTR + 0.20·sentiment + 0.15·MLU`.

---

## 9. ML pipeline — calibration + ordinal-aware metrics

### 9.1 Calibrated probabilities

Every fusion classifier (RF, XGB, LR) is now wrapped in
`sklearn.calibration.CalibratedClassifierCV(method="isotonic", cv=3)`.
Raw `predict_proba` from a Random Forest is *not* a probability —
it is a vote-fraction that is overconfident at the extremes and flat
in the middle. Calibration is mandatory for any decision support
where the user reads the probability as a confidence
(Van Calster et al. 2019).

### 9.2 Multi-class Brier score

Reported in `reports/full_metrics.json`:

| Model | Brier ↓ |
|-------|--------:|
| RF | 0.084 |
| XGB | 0.059 |
| LR | 0.097 |

Random-uniform baseline on K=4 is 0.75; perfect = 0. All three
classifiers are now reasonably calibrated.

### 9.3 Quadratic Weighted Kappa (ordinal agreement)

The four classes are *ordinal* (`Normal < MCI < Moderate < Severe`).
A misclassification of `MCI → Severe` is clinically much worse than
`MCI → Moderate`. We now report Cohen 1968 quadratic-weighted κ in
addition to nominal accuracy / F1:

| Model | QWK ↑ |
|-------|------:|
| RF | 0.951 |
| XGB | 0.964 |
| LR | 0.997 |

LR scores nearly perfectly because the synthetic labels are a linear
function of `(C, B, P, M)` and LR is a linear classifier — see §10.

### 9.4 Screening metric (Normal vs. rest)

Sensitivity / specificity for the screening question
"any cognitive impairment vs. Normal", which is what a primary-care
screener actually decides on (Petersen 2011 algorithm step 1):

| Model | Sens | Spec | PPV | NPV |
|-------|-----:|-----:|----:|----:|
| RF | 0.999 | 0.692 | 0.996 | 0.900 |
| XGB | 0.998 | 0.692 | 0.996 | 0.818 |
| LR | 1.000 | 0.769 | 0.997 | 1.000 |

Sensitivity is excellent (we want very few missed cases). Specificity
is moderate, because the synthetic generator is heavily weighted
toward impaired cases (only ~13 `Normal` samples in the test split):
this is a known artefact of the synthetic prevalence and **must be
re-measured on a real screening cohort** with realistic prevalence
(typically 5–10 % dementia, 15–20 % MCI in 65+ age-bands —
Petersen et al. 2018).

---

## 10. Honest limitations — what is *still* required for clinical validation

Every fix in this document removes a specific, documented bug or
heuristic. None of them substitute for the items below, all of which
remain mandatory before any clinical use:

1. **Real labelled data.** The training data is still 100 % synthetic.
   The classifier's accuracy / AUC / κ measure self-consistency on
   synthetic labels, not clinical performance. Replace with at least
   one of:
   - ADNI (Alzheimer's Disease Neuroimaging Initiative)
   - OASIS-3 (Open Access Series of Imaging Studies)
   - NACC (National Alzheimer's Coordinating Center)
   - AIBL (Australian Imaging, Biomarkers and Lifestyle)

2. **Decouple labels from features.** Currently
   `final_risk_label = class_from_S(0.40·C + ...)`. Train against
   *clinician-adjudicated* labels (e.g. CDR, neuropsych battery)
   instead, otherwise the classifier just inverts a known formula.

3. **Replace the 10-question MMSE-style test with a validated
   instrument** (full MMSE-30 under licence, MoCA, or ACE-III).
   Multiple-choice partial-credit (5 / 2 / 0 by index distance) has
   no psychometric basis and should be replaced with raw item scoring.

4. **Pre-registered prospective external-cohort study** following
   TRIPOD+AI (Collins et al. 2024, BMJ 385:e078378). Primary endpoint:
   sensitivity at fixed cutoff vs. clinician diagnosis; secondary:
   AUC, calibration, fairness across age / sex / education / language.

5. **Site / device robustness.** Test–retest, camera/microphone
   variability, lighting, latency. Currently the system has no
   measurement of these confounds.

6. **Replace the lexicon-based sentiment** with a pretrained
   transformer model (BERT / RoBERTa) in `speech_quality_score`.

7. **Risk management file** under ISO 14971, with the failure modes
   listed above (false-positive in anxious patients, false-negative
   in highly-educated AD patients) and explicit mitigations for each.

8. **Regulatory pathway** — most likely SaMD class IIa under EU MDR
   or 510(k) under US FDA, with a Clinical Evaluation Plan and a
   prospective study at a non-training site.

9. **Re-derive cutoffs.** The 78 / 65 / 50 thresholds were
   inherited from the original prototype. On a labelled cohort,
   re-derive each as the ROC-optimal cutoff at a chosen target
   sensitivity (e.g. 90 % for screening intent).

10. **Fairness audit.** Disaggregate every reported metric by age band,
    sex, education years, primary language, and ethnicity.

---

## 11. Conversational Cognitive Assessment Agent (add-on module)

**Purpose.** The conversational agent is used to passively assess cognitive and emotional indicators through natural dialogue, **without explicitly conducting a formal test**. It does not replace validated paper batteries; it supplements structured tasks with ecologically valid connected speech and self-report tone.

**Integration (core unchanged).** Top-level fusion remains \(S = 0.40\,C + 0.15\,B + 0.20\,P + 0.25\,(100-M)\) and risk bins are unchanged. The module contributes as follows:

- **Behavioral (B):** The dialogue composite (mean of four 0–100 sub-scores: speech fluency, memory coherence, emotional stability, response relevance) is **blended into the speech channel** of `compute_B_phase2`: 28% of the effective speech signal when Web Speech samples exist; if no speech samples exist, the dialogue score supplies the speech-weighted portion of B with adjusted channel weights so device limitations do not zero out behavioral speech evidence.
- **Cognitive (C):** After domain sums are built from structured answers, **memory** and **language** domains receive a **small symmetric nudge** (±2.5 points max each on the 0–20 domain scale) derived from memory-coherence and (fluency + relevance) sub-scores, centred at 50. This preserves clinical primacy of formal tasks while reflecting narrative recall and discourse quality.

**Scoring.** Sub-scores use literature-aligned heuristics (hesitation / filler: Clark & Fox Tree 2002; connected speech: Boschi 2017, Fraser 2016; sentiment lexicon: same lightweight approach as `behavior_aggregation`). Response relevance uses transparent keyword overlap by dialogue step (orientation, daily routine, autobiographical, cultural, affect). **Full clinical validation** would require human-rated transcripts and outcome labels.

---

## 12. Bibliography (alphabetical)

- **Albert MS et al. 2011** *The diagnosis of mild cognitive impairment due to Alzheimer's disease: NIA-AA recommendations.* Alzheimers Dement 7:270.
- **Boschi V et al. 2017** *Connected speech in neurodegenerative language disorders: a review.* Front Psychol 8:269.
- **Brier GW 1950** *Verification of forecasts expressed in terms of probability.* Mon Weather Rev 78:1.
- **Burton CL et al. 2008** *Cognitive load and facial expression of effort.*
- **Clark HH, Fox Tree JE 2002** *Using uh and um in spontaneous speaking.* Cognition 84:73.
- **Cohen J 1968** *Weighted kappa: nominal scale agreement provision for scaled disagreement.* Psychol Bull 70:213.
- **Collins GS et al. 2024** *TRIPOD+AI statement.* BMJ 385:e078378.
- **Crum RM et al. 1993** *Population-based norms for the MMSE by age and educational level.* JAMA 269:2386.
- **Deary IJ, Liewald D, Nissan J 2010** *Reaction times and intelligence differences.* Neurosci Biobehav Rev 34:1029.
- **Dubois B et al. 2014** *Advancing research diagnostic criteria for Alzheimer's disease: the IWG-2 criteria.* Lancet Neurol 13:614.
- **Ekman P 1992** *An argument for basic emotions.* Cogn Emot 6:169.
- **Folstein MF, Folstein SE, McHugh PR 1975** *Mini-mental state.* J Psychiatr Res 12:189.
- **Frank E, Hall M 2001** *A simple approach to ordinal classification.* ECML 145.
- **Fraser KC, Meltzer JA, Rudzicz F 2016** *Linguistic features identify Alzheimer's disease in narrative speech.* J Alzheimers Dis 49:407.
- **Frisoni GB et al. 2010** *The clinical use of structural MRI in Alzheimer disease.* Nat Rev Neurol 6:67.
- **Henry JD et al. 2008** *A meta-analytic review of emotion recognition in dementia.* Neuropsychologia 46:2855.
- **Hultsch DF et al. 2002** *Variability in reaction time performance of younger and older adults.* J Gerontol B Psychol Sci 57:101.
- **Jack CR et al. 2018** *NIA-AA Research Framework: toward a biological definition of Alzheimer's disease.* Alzheimers Dement 14:535.
- **Kang H et al. 2014** *Pseudodementia and depression: a review.*
- **Mitchell AJ 2009** *A meta-analysis of the accuracy of the MMSE in the detection of dementia and MCI.* J Psychiatr Res 43:411.
- **Mollahosseini A, Hasani B, Mahoor MH 2017** *AffectNet: a database for facial expression, valence, and arousal computing in the wild.* IEEE TAffectiveComputing 10:18.
- **Nasreddine ZS et al. 2005** *MoCA: a brief screening tool for MCI.* JAGS 53:695.
- **Petersen RC 2004** *Mild cognitive impairment as a diagnostic entity.* J Intern Med 256:183.
- **Petersen RC et al. 2018** *Practice guideline update: MCI.* Neurology 90:126.
- **Phillips M et al. 2013** *Reaction time variability in MCI/AD.* Neuropsychologia 51:13.
- **Salthouse TA 1996** *The processing-speed theory of adult age differences in cognition.* Psychol Rev 103:403.
- **Tombaugh TN, McIntyre NJ 1992** *The Mini-Mental State Examination: a comprehensive review.* JAGS 40:922.
- **Van Calster B et al. 2019** *Calibration: the Achilles heel of predictive analytics.* BMC Medicine 17:230.
- **Wells CE 1979** *Pseudodementia.* Am J Psychiatry 136:895.
