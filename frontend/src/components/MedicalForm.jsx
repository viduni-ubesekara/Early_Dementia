/**
 * Medical history & report form. Values feed the medical ML model (M, H, R, I).
 * Kept self-contained so the test page only manages cognition + behavior.
 */

import { useRef, useState } from "react";
import { analyzeMriImage } from "../api.js";

const BIN = [
  ["dementia_history", "Family / personal dementia history"],
  ["stroke_history", "Stroke history"],
  ["Parkinsons", "Parkinson's"],
  ["diabetes", "Diabetes"],
  ["hypertension", "Hypertension"],
  ["depression", "Depression"],
  ["anxiety", "Anxiety / GAD"],
  ["confusion_reported", "Confusion reported by carer"],
  ["memory_loss_reported", "Memory loss reported by carer"],
  ["Alzheimer_pattern_detected", "Alzheimer pattern on imaging"],
];

const NUM = [
  { key: "medication_load", label: "Medication load (count)", min: 0, max: 20, step: 1 },
  { key: "MMSE_previous_score", label: "Previous MMSE score (0–30)", min: 0, max: 30, step: 0.5 },
  { key: "MMSE_decline_rate", label: "MMSE decline rate / yr (0–5)", min: 0, max: 5, step: 0.1 },
  { key: "hippocampal_volume", label: "Hippocampal volume (mm³)", min: 1500, max: 5500, step: 50 },
  { key: "brain_atrophy_level", label: "Brain atrophy level (0–3)", min: 0, max: 3, step: 1 },
  { key: "cortical_thickness", label: "Cortical thickness (mm)", min: 1.5, max: 3.0, step: 0.05 },
  { key: "lesion_score", label: "White-matter lesion score (0–10)", min: 0, max: 10, step: 0.5 },
];

export default function MedicalForm({ value, onChange, disabled }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const setNum = (k, v) => set(k, v === "" ? 0 : Number(v));
  const setBin = (k) => set(k, value[k] ? 0 : 1);
  const mriInputRef = useRef(null);
  const [mriBusy, setMriBusy] = useState(false);
  const [mriErr, setMriErr] = useState(null);
  const [mriLast, setMriLast] = useState(null);

  const onMriSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || disabled) return;
    setMriErr(null);
    setMriLast(null);
    setMriBusy(true);
    try {
      const r = await analyzeMriImage(file);
      setMriLast(r);
      const sf = r.suggested_fields || {};
      onChange({
        ...value,
        hippocampal_volume: sf.hippocampal_volume ?? value.hippocampal_volume,
        brain_atrophy_level: sf.brain_atrophy_level ?? value.brain_atrophy_level,
        cortical_thickness: sf.cortical_thickness ?? value.cortical_thickness,
        lesion_score: sf.lesion_score ?? value.lesion_score,
        physician_rating: sf.physician_rating ?? value.physician_rating,
        Alzheimer_pattern_detected: sf.Alzheimer_pattern_detected ?? value.Alzheimer_pattern_detected,
      });
    } catch (err) {
      setMriErr(err.message || String(err));
    } finally {
      setMriBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="tag">Medical history & reports (feed the ML medical score)</div>

      <div
        className="card"
        style={{
          marginTop: 12,
          padding: "12px 14px",
          background: "var(--panel-2)",
          border: "2px solid var(--border)",
        }}
      >
        <div className="tag">MRI slice (optional)</div>
        <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: "8px 0 10px", lineHeight: 1.45 }}>
          Upload one axial (or single) brain MRI slice as PNG or JPEG. When a trained{" "}
          <code style={{ fontSize: "0.85em" }}>best_mri_model.keras</code> is on the server, we run the same
          MobileNetV2 head as your notebook and map severity to imaging fields below. MMSE and medication
          must still be entered from the chart. True mm³ / lesion load need full volumetric pipelines — these
          numbers are <strong>form proxies</strong> for the fusion model.
        </p>
        <input
          ref={mriInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || mriBusy}
          onChange={onMriSelected}
          style={{ display: "none" }}
        />
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled || mriBusy}
            onClick={() => mriInputRef.current?.click()}
          >
            {mriBusy ? "Analyzing…" : "Upload MRI slice & fill imaging fields"}
          </button>
          {mriLast && (
            <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
              {mriLast.predicted_label} ({(mriLast.confidence * 100).toFixed(0)}%) ·{" "}
              {mriLast.method === "keras_model" ? "model" : "fallback"}
            </span>
          )}
        </div>
        {mriErr && (
          <p className="err" style={{ marginTop: 10, marginBottom: 0 }}>
            {mriErr}
          </p>
        )}
      </div>

      <div className="grid2" style={{ marginTop: 8 }}>
        {NUM.map((f) => (
          <div key={f.key}>
            <label htmlFor={`m_${f.key}`}>{f.label}</label>
            <input
              id={`m_${f.key}`}
              type="number"
              value={value[f.key] ?? 0}
              min={f.min}
              max={f.max}
              step={f.step}
              disabled={disabled}
              onChange={(e) => setNum(f.key, e.target.value)}
            />
          </div>
        ))}
        <div>
          <label htmlFor="m_phys">Physician rating (1 = good … 4 = poor)</label>
          <select
            id="m_phys"
            value={value.physician_rating ?? 2}
            disabled={disabled}
            onChange={(e) => set("physician_rating", Number(e.target.value))}
          >
            <option value={1}>1 — good</option>
            <option value={2}>2 — fair</option>
            <option value={3}>3 — concerning</option>
            <option value={4}>4 — poor</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="tag">History flags</div>
        <div className="meter" style={{ marginTop: 8 }}>
          {BIN.map(([k, label]) => {
            const on = !!value[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => !disabled && setBin(k)}
                className="pill"
                style={{
                  cursor: disabled ? "default" : "pointer",
                  borderColor: on ? "var(--accent)" : "var(--border)",
                  background: on ? "var(--success-bg)" : "var(--panel)",
                  color: on ? "var(--accent-ink)" : "var(--text)",
                  borderWidth: 2,
                }}
                aria-pressed={on}
              >
                {on ? "✓ " : ""}
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
