"""
Train medical regressor (RF) and three fusion classifiers (RF, XGB, LR).

Clinical-validation upgrades vs. the original trainer:
  - Each fusion classifier is wrapped in `CalibratedClassifierCV`
    (isotonic, cv=3) so `predict_proba` is a calibrated probability,
    not a raw decision-tree vote count. Calibration is mandatory for
    any clinical decision support (Van Calster et al. 2019,
    BMC Medicine 17:230 - 'Calibration: the Achilles heel of
    predictive analytics').
  - Reports now include Brier score (multi-class), Quadratic Weighted
    Kappa (the standard ordinal-classification metric for graded
    diagnoses; Cohen 1968), and a `learned_fusion_weights` block from
    L1-regularised logistic regression on (C,B,P,M) so that the
    literature-justified default weights can be compared to weights
    induced from the (synthetic) labels.
  - Sensitivity / specificity / PPV / NPV reported per class for the
    'screen for any cognitive impairment' (Normal vs. rest)
    decision - the metric that matters for a screening tool.
"""

from __future__ import annotations

import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    cohen_kappa_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import label_binarize, MinMaxScaler
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from xgboost import XGBClassifier, XGBRegressor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.ml.feature_blocks import (
    build_medical_preprocessor,
    medical_feature_frame,
    medical_sample_weight,
    medical_target,
)
from backend.data_generation.fusion_formulas import CLASS_TO_IDX, IDX_TO_CLASS

MODEL_DIR = os.path.join(ROOT, "models")
DATA_DIR = os.path.join(ROOT, "data")
REPORT_DIR = os.path.join(ROOT, "reports")


def y_to_index(labels: np.ndarray) -> np.ndarray:
    return np.array([CLASS_TO_IDX[str(x)] for x in labels])


# =====================================================================
# Medical regressor (unchanged structurally; now sees age/edu/anxiety)
# =====================================================================


def _fit_rf_regressor(X_p: np.ndarray, y: np.ndarray, sw: np.ndarray) -> RandomForestRegressor:
    m = RandomForestRegressor(
        n_estimators=200, max_depth=12, min_samples_leaf=2, n_jobs=-1, random_state=0
    )
    m.fit(X_p, y, sample_weight=sw)
    return m


def train_medical_regressor(med: pd.DataFrame) -> dict:
    X = medical_feature_frame(med)
    y_M = medical_target(med)
    y_H = med["H_clinical_risk"].values.astype(np.float64)
    y_R = med["R_report_risk"].values.astype(np.float64)
    y_I = med["I_imaging_risk"].values.astype(np.float64)
    sw = medical_sample_weight(med)

    X_train, X_test, sw_tr, _, yM_tr, yM_te = train_test_split(
        X, sw, y_M, test_size=0.2, random_state=11
    )
    pre2 = build_medical_preprocessor()
    X_train_p = pre2.fit_transform(X_train)
    X_test_p = pre2.transform(X_test)

    rf_M = _fit_rf_regressor(X_train_p, yM_tr, sw_tr)
    mae_rf = float(np.mean(np.abs(rf_M.predict(X_test_p) - yM_te)))

    xgb_r = XGBRegressor(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.8,
        random_state=0,
        n_jobs=-1,
    )
    xgb_r.fit(X_train_p, yM_tr, sample_weight=sw_tr, verbose=False)
    mae_xgb = float(np.mean(np.abs(xgb_r.predict(X_test_p) - yM_te)))

    use_name = "random_forest" if mae_rf <= mae_xgb * 1.02 else "xgboost"

    pre_full = build_medical_preprocessor()
    X_full_p = pre_full.fit_transform(X)
    final_M = _fit_rf_regressor(X_full_p, y_M, sw)
    final_H = _fit_rf_regressor(X_full_p, y_H, sw)
    final_R = _fit_rf_regressor(X_full_p, y_R, sw)
    final_I = _fit_rf_regressor(X_full_p, y_I, sw)
    best_pipe = Pipeline([("pre", pre_full), ("model", final_M)])

    joblib.dump(
        {
            "pipeline": best_pipe,
            "preprocessor": pre_full,
            "feature_columns": list(X.columns),
            "M_model": final_M,
            "H_model": final_H,
            "R_model": final_R,
            "I_model": final_I,
        },
        os.path.join(MODEL_DIR, "medical_regressor.joblib"),
    )
    return {
        "mae_test_rf": mae_rf,
        "mae_test_xgboost": mae_xgb,
        "chose": use_name,
    }


# =====================================================================
# Fusion classifiers - now calibrated & ordinal-aware metrics
# =====================================================================


def _multiclass_brier(y_true_idx: np.ndarray, y_proba: np.ndarray) -> float:
    """Multi-class Brier score (Brier 1950 generalisation): mean over
    rows of the squared Euclidean distance between the one-hot label
    and the probability vector. Lower is better; perfect = 0,
    random-uniform on K=4 = 0.75."""
    K = y_proba.shape[1]
    onehot = np.zeros_like(y_proba)
    onehot[np.arange(len(y_true_idx)), y_true_idx.astype(int)] = 1.0
    return float(np.mean(np.sum((y_proba - onehot) ** 2, axis=1)))


def _screening_metrics_normal_vs_rest(
    y_true_idx: np.ndarray, pred_idx: np.ndarray
) -> dict:
    """Sensitivity/specificity for the 'any cognitive impairment'
    screen - i.e. positive = MCI/Moderate/Severe, negative = Normal.
    This is the metric a screening clinician actually cares about
    (Petersen 2011 algorithm step 1)."""
    pos_true = (y_true_idx >= 1).astype(int)
    pos_pred = (pred_idx >= 1).astype(int)
    tp = int(((pos_true == 1) & (pos_pred == 1)).sum())
    fp = int(((pos_true == 0) & (pos_pred == 1)).sum())
    tn = int(((pos_true == 0) & (pos_pred == 0)).sum())
    fn = int(((pos_true == 1) & (pos_pred == 0)).sum())
    sens = tp / max(1, tp + fn)
    spec = tn / max(1, tn + fp)
    ppv = tp / max(1, tp + fp)
    npv = tn / max(1, tn + fn)
    return {
        "sensitivity": float(sens),
        "specificity": float(spec),
        "ppv": float(ppv),
        "npv": float(npv),
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
    }


def _learned_fusion_weights(X: np.ndarray, idx: np.ndarray) -> dict:
    """Fit an L1-regularised multinomial logistic regression on (C,B,P,M)
    to *learn* the fusion weights from labels, then report them next
    to the literature-justified defaults so a reviewer can see whether
    the data agrees with the chosen weights.
    """
    scaler = MinMaxScaler(feature_range=(0, 100))
    Xs = scaler.fit_transform(X)
    lr = LogisticRegression(
        penalty="l1", solver="saga", C=0.1, max_iter=4000,
        random_state=0,
    )
    lr.fit(Xs, idx)
    coefs = np.abs(lr.coef_).mean(axis=0)
    if coefs.sum() == 0:
        normed = [0.25, 0.25, 0.25, 0.25]
    else:
        normed = (coefs / coefs.sum()).tolist()
    return {
        "feature_order": ["C", "B", "P", "M"],
        "default_weights_literature": [0.40, 0.15, 0.20, 0.25],
        "learned_weights_l1_logreg": [round(float(v), 4) for v in normed],
        "note": (
            "Defaults are literature-justified (NIA-AA 2018, Petersen 2004, "
            "Frisoni 2010). 'Learned' weights are recovered from the "
            "current synthetic labels and are intended for comparison "
            "only - they should not replace the defaults until labelled "
            "real-cohort data is available."
        ),
    }


def train_fusion_classifiers(fusion: pd.DataFrame) -> dict:
    X = fusion[["C", "B", "P", "M"]].values.astype(np.float64)
    y = fusion["final_risk_label"].values
    y_idx = y_to_index(y)

    learned = _learned_fusion_weights(X, y_idx)

    X_train, X_test, _, _, idx_tr, idx_te = train_test_split(
        X, y, y_idx, test_size=0.2, random_state=22, stratify=y_idx
    )
    scaler = MinMaxScaler(feature_range=(0, 100))
    X_tr = scaler.fit_transform(X_train)
    X_ts = scaler.transform(X_test)

    base_models = [
        (
            "random_forest",
            RandomForestClassifier(
                n_estimators=400,
                max_depth=8,
                min_samples_leaf=2,
                n_jobs=-1,
                class_weight="balanced",
                random_state=0,
            ),
        ),
        (
            "xgboost",
            XGBClassifier(
                n_estimators=300,
                max_depth=4,
                learning_rate=0.06,
                subsample=0.9,
                colsample_bytree=0.9,
                objective="multi:softprob",
                num_class=4,
                eval_metric="mlogloss",
                random_state=0,
                n_jobs=-1,
            ),
        ),
        (
            "logistic_regression",
            LogisticRegression(
                max_iter=2000,
                class_weight="balanced",
                random_state=0,
                solver="lbfgs",
            ),
        ),
    ]

    results: dict = {"learned_fusion_weights": learned}

    idx_tr_ = np.asarray(idx_tr, dtype=np.int32).ravel()
    idx_te_ = np.asarray(idx_te, dtype=np.int32).ravel()

    for name, base in base_models:
        # Wrap in calibrated classifier (isotonic) for proper
        # probability outputs - mandatory for clinical decision support.
        clf = CalibratedClassifierCV(base, method="isotonic", cv=3)
        clf.fit(X_tr, idx_tr_)
        pred_idx = clf.predict(X_ts).astype(np.int32)
        y_prob = clf.predict_proba(X_ts)

        acc = accuracy_score(idx_te_, pred_idx)
        prf = precision_recall_fscore_support(
            idx_te_, pred_idx, average="macro", zero_division=0
        )
        f1m = f1_score(idx_te_, pred_idx, average="macro", zero_division=0)
        # Quadratic Weighted Kappa - ordinal-aware agreement metric.
        # Penalises a 2-tier mistake (e.g. MCI->Severe) more than a
        # 1-tier mistake (MCI->Moderate).
        qwk = float(cohen_kappa_score(idx_te_, pred_idx, weights="quadratic"))
        brier = _multiclass_brier(idx_te_, y_prob)
        screen = _screening_metrics_normal_vs_rest(idx_te_, pred_idx)

        try:
            auc = float(
                roc_auc_score(
                    label_binarize(idx_te_, classes=[0, 1, 2, 3]),
                    y_prob,
                    average="macro",
                    multi_class="ovr",
                )
            )
        except Exception:
            auc = 0.0

        results[name] = {
            "accuracy": acc,
            "macro_precision": float(prf[0]),
            "macro_recall": float(prf[1]),
            "macro_f1": float(f1m),
            "quadratic_weighted_kappa": qwk,
            "brier_score_multiclass": brier,
            "roc_auc_macro_ovr": auc,
            "screening_normal_vs_rest": screen,
            "confusion_matrix": confusion_matrix(
                idx_te_, pred_idx, labels=[0, 1, 2, 3]
            ).tolist(),
        }

        joblib.dump(
            {"clf": clf, "scaler": scaler,
             "class_order": [IDX_TO_CLASS[i] for i in range(4)]},
            os.path.join(MODEL_DIR, f"fusion_{name}.joblib"),
        )

    _plot_roc_ovo(X_ts, idx_te, MODEL_DIR, REPORT_DIR)
    results["class_labels"] = [IDX_TO_CLASS[i] for i in range(4)]
    results["data_kind"] = (
        "synthetic - metrics measure self-consistency on synthetic "
        "labels, not clinical performance"
    )

    with open(os.path.join(REPORT_DIR, "model_metrics.json"), "w", encoding="utf-8") as f:
        out_core = {
            k: {kk: vv for kk, vv in v.items() if kk != "confusion_matrix"}
            for k, v in results.items()
            if isinstance(v, dict) and "accuracy" in v
        }
        json.dump(out_core, f, indent=2)
    with open(os.path.join(REPORT_DIR, "full_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    return results


def _plot_roc_ovo(X_test: np.ndarray, y_test_idx: np.ndarray, mdir: str, rdir: str) -> None:
    y_test_idx = np.asarray(y_test_idx, dtype=int).ravel()
    y_bin = label_binarize(y_test_idx, classes=[0, 1, 2, 3])
    class_names = [IDX_TO_CLASS[i] for i in range(4)]
    for name in ["random_forest", "xgboost", "logistic_regression"]:
        p = joblib.load(os.path.join(mdir, f"fusion_{name}.joblib"))
        clf, scaler = p["clf"], p["scaler"]
        Xs = scaler.transform(X_test)
        if not hasattr(clf, "predict_proba"):
            continue
        proba = clf.predict_proba(Xs)
        plt.figure(figsize=(7, 5))
        for c in range(4):
            y_c = y_bin[:, c]
            fpr, tpr, _ = roc_curve(y_c, proba[:, c])
            try:
                auc = float(roc_auc_score(y_c, proba[:, c]))
            except Exception:
                auc = 0.0
            plt.plot(fpr, tpr, label=f"{class_names[c]} (AUC={auc:.2f})")
        plt.plot([0, 1], [0, 1], "k--", alpha=0.3)
        plt.xlabel("FPR")
        plt.ylabel("TPR")
        plt.title(f"ROC (OvR) - {name}")
        plt.legend()
        os.makedirs(rdir, exist_ok=True)
        fp = os.path.join(rdir, f"roc_{name}.png")
        plt.tight_layout()
        plt.savefig(fp, dpi=120)
        plt.close()


def main() -> None:
    os.makedirs(MODEL_DIR, exist_ok=True)
    os.makedirs(REPORT_DIR, exist_ok=True)
    med_path = os.path.join(DATA_DIR, "medical.csv")
    fusion_path = os.path.join(DATA_DIR, "fusion.csv")
    if not os.path.exists(med_path) or not os.path.exists(fusion_path):
        raise SystemExit("Run generate_datasets first.")
    med = pd.read_csv(med_path)
    fusion = pd.read_csv(fusion_path)
    m_stats = train_medical_regressor(med)
    c_stats = train_fusion_classifiers(fusion)
    out = {"medical_regressor": m_stats, "fusion": c_stats}
    with open(os.path.join(REPORT_DIR, "training_summary.json"), "w", encoding="utf-8") as f:
        json.dump(
            {"medical_regressor": m_stats,
             "learned_fusion_weights": c_stats.get("learned_fusion_weights")},
            f, indent=2,
        )
    print("Training done. See reports/ and models/")


if __name__ == "__main__":
    main()
