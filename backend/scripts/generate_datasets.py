"""Generate medical, cognitive, and fusion CSVs into project data/. Run from repo root: python -m backend.scripts.generate_datasets"""

from __future__ import annotations

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.data_generation.synthetic_medical import generate_medical
from backend.data_generation.synthetic_cognitive import (
    generate_cognitive_and_match_medical,
    build_fusion_table,
)


def main() -> None:
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    n = 5000
    med = generate_medical(n=n, seed=42)
    cog = generate_cognitive_and_match_medical(med, seed=7)
    fusion = build_fusion_table(cog, med)

    med_path = os.path.join(ROOT, "data", "medical.csv")
    cog_path = os.path.join(ROOT, "data", "cognitive_session.csv")
    fusion_path = os.path.join(ROOT, "data", "fusion.csv")

    # Drop helper columns for export if we want only spec features — keep H,R,I in medical for research transparency
    med_out = med.drop(columns=["H_clinical_risk", "R_report_risk", "I_imaging_risk"], errors="ignore")
    # Per spec, medical doesn't list H,R,I as columns for users — but they're useful for viva. Save full med to separate optional file
    med.to_csv(med_path, index=False)
    med_out.to_csv(os.path.join(ROOT, "data", "medical_features_only.csv"), index=False)

    cog.to_csv(cog_path, index=False)
    fusion.to_csv(fusion_path, index=False)
    print("Wrote:", med_path, cog_path, fusion_path, "rows", len(med), len(cog), len(fusion))


if __name__ == "__main__":
    main()
