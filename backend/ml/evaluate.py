"""Load reports/full_metrics.json and print a concise viva-style summary. Optional: --latex."""

from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--json", default=os.path.join(ROOT, "reports", "full_metrics.json"))
    args = p.parse_args()
    if not os.path.exists(args.json):
        print("No metrics file. Run: python -m backend.ml.train_all", file=sys.stderr)
        sys.exit(1)
    with open(args.json, encoding="utf-8") as f:
        m = json.load(f)
    for k in ("random_forest", "xgboost", "logistic_regression"):
        if k not in m:
            continue
        print(f"=== {k} ===")
        d = m[k]
        for field in (
            "accuracy",
            "macro_precision",
            "macro_recall",
            "macro_f1",
            "roc_auc_macro_ovr",
        ):
            if field in d:
                print(f"  {field}: {d[field]:.4f}" if isinstance(d[field], float) else f"  {field}: {d[field]}")
        if "confusion_matrix" in d:
            print("  confusion_matrix [rows=actual, cols=pred, order Normal,MCI,Moderate,Severe]:")
            for row in d["confusion_matrix"]:
                print("   ", row)


if __name__ == "__main__":
    main()
