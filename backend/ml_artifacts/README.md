# MRI model weights (optional)

Place your trained **`best_mri_model.keras`** here (export from Colab: `mri_artifacts/best_mri_model.keras` in `MRI Model.ipynb`).

- Set **`MRI_MODEL_PATH`** to override the default path.
- Install TensorFlow for inference: `pip install tensorflow-cpu` (or `tensorflow` with GPU).

Without this file the API still runs using a **heuristic fallback** on the uploaded slice (demo only).
