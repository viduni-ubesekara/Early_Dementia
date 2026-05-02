import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const STORAGE_KEY = "patientInfo";

const GENDERS = ["Female", "Male", "Other", "Prefer not to say"];
const HANDS = ["Right", "Left", "Ambidextrous"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultInfo() {
  return {
    fullName: "",
    patientId: "",
    dateOfBirth: "",
    age: "",
    gender: "",
    educationYears: "",
    handedness: "Right",
    primaryLanguage: "English",
    contactPhone: "",
    contactEmail: "",
    examinerName: "",
    assessmentDate: todayISO(),
    notes: "",
    consent: false,
  };
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

export default function PatientInfo() {
  const nav = useNavigate();
  const [info, setInfo] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return { ...defaultInfo(), ...JSON.parse(raw) };
    } catch {}
    return defaultInfo();
  });
  const [submitted, setSubmitted] = useState(false);

  // Auto-derive age from DOB if user filled DOB but not age
  useEffect(() => {
    const derived = ageFromDob(info.dateOfBirth);
    if (derived != null && (info.age === "" || info.age == null)) {
      setInfo((p) => ({ ...p, age: String(derived) }));
    }
  }, [info.dateOfBirth]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setInfo((p) => ({ ...p, [k]: v }));

  const errors = useMemo(() => {
    const e = {};
    if (!info.fullName.trim()) e.fullName = "Required";
    const ageNum = Number(info.age);
    if (info.age === "" || Number.isNaN(ageNum)) e.age = "Required";
    else if (ageNum < 0 || ageNum > 130) e.age = "Must be 0–130";
    if (!info.gender) e.gender = "Select one";
    if (info.educationYears !== "" && (Number(info.educationYears) < 0 || Number(info.educationYears) > 30))
      e.educationYears = "0–30";
    if (info.contactEmail && !/^\S+@\S+\.\S+$/.test(info.contactEmail))
      e.contactEmail = "Invalid email";
    if (!info.consent) e.consent = "Required to proceed";
    return e;
  }, [info]);

  const onSubmit = (ev) => {
    ev?.preventDefault?.();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    const payload = {
      ...info,
      age: Number(info.age),
      educationYears: info.educationYears === "" ? null : Number(info.educationYears),
      savedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    const preferred = sessionStorage.getItem("preferredFlow");
    nav(preferred === "legacy" ? "/test" : "/test-advanced");
  };

  const showErr = (k) => submitted && errors[k];

  return (
    <div className="app-shell">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link to="/">← Home</Link>
        <span className="tag">Step 1 of 3 · Patient information</span>
      </div>
      <h1>Patient information</h1>
      <p className="lead">
        Demographic and contact details for this assessment. This is stored only in your browser
        session — nothing here is sent to the ML model. Step 2 will collect medical/imaging data
        used by the medical regressor.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div className="card">
          <div className="tag">Identity</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div>
              <label htmlFor="p_fullName">Full name *</label>
              <input
                id="p_fullName"
                type="text"
                value={info.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                placeholder="e.g. Jane Doe"
                autoComplete="name"
              />
              {showErr("fullName") && <p className="err">{errors.fullName}</p>}
            </div>
            <div>
              <label htmlFor="p_patientId">Patient ID / MRN / NIC (optional)</label>
              <input
                id="p_patientId"
                type="text"
                value={info.patientId}
                onChange={(e) => set("patientId", e.target.value)}
                placeholder="optional"
              />
            </div>
            <div>
              <label htmlFor="p_dob">Date of birth (optional)</label>
              <input
                id="p_dob"
                type="date"
                value={info.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="p_age">Age *</label>
              <input
                id="p_age"
                type="number"
                min={0}
                max={130}
                value={info.age}
                onChange={(e) => set("age", e.target.value)}
              />
              {showErr("age") && <p className="err">{errors.age}</p>}
            </div>
            <div>
              <label htmlFor="p_gender">Gender *</label>
              <select
                id="p_gender"
                value={info.gender}
                onChange={(e) => set("gender", e.target.value)}
              >
                <option value="">Select…</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              {showErr("gender") && <p className="err">{errors.gender}</p>}
            </div>
            <div>
              <label htmlFor="p_handed">Handedness</label>
              <select
                id="p_handed"
                value={info.handedness}
                onChange={(e) => set("handedness", e.target.value)}
              >
                {HANDS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="tag">Background</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div>
              <label htmlFor="p_edu">Years of formal education</label>
              <input
                id="p_edu"
                type="number"
                min={0}
                max={30}
                step={1}
                value={info.educationYears}
                onChange={(e) => set("educationYears", e.target.value)}
              />
              {showErr("educationYears") && <p className="err">{errors.educationYears}</p>}
            </div>
            <div>
              <label htmlFor="p_lang">Primary language</label>
              <input
                id="p_lang"
                type="text"
                value={info.primaryLanguage}
                onChange={(e) => set("primaryLanguage", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="p_phone">Contact phone (optional)</label>
              <input
                id="p_phone"
                type="tel"
                value={info.contactPhone}
                onChange={(e) => set("contactPhone", e.target.value)}
                placeholder="+94 ..."
                autoComplete="tel"
              />
            </div>
            <div>
              <label htmlFor="p_email">Contact email (optional)</label>
              <input
                id="p_email"
                type="email"
                value={info.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
              />
              {showErr("contactEmail") && <p className="err">{errors.contactEmail}</p>}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="tag">Assessment</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div>
              <label htmlFor="p_examiner">Examiner / clinician (optional)</label>
              <input
                id="p_examiner"
                type="text"
                value={info.examinerName}
                onChange={(e) => set("examinerName", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="p_date">Date of assessment</label>
              <input
                id="p_date"
                type="date"
                value={info.assessmentDate}
                onChange={(e) => set("assessmentDate", e.target.value)}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="p_notes">Notes (optional)</label>
              <textarea
                id="p_notes"
                rows={3}
                style={{ maxWidth: "100%" }}
                value={info.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="e.g. patient wears glasses, prefers Sinhala explanations, etc."
              />
            </div>
          </div>
        </div>

        <div className="card">
          <label className="row" style={{ alignItems: "flex-start", gap: 10 }}>
            <input
              type="checkbox"
              style={{ width: 18, height: 18, marginTop: 4, maxWidth: 18 }}
              checked={!!info.consent}
              onChange={(e) => set("consent", e.target.checked)}
            />
            <span style={{ color: "var(--text)" }}>
              I confirm this is a research prototype using synthetic-trained models, that no medical
              decision will be made on the basis of these results, and that the patient has agreed
              to the assessment.
            </span>
          </label>
          {showErr("consent") && <p className="err">{errors.consent}</p>}
        </div>

        <div style={{ marginTop: 8 }}>
          <button className="btn btn-primary" type="submit">
            Continue to test →
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            style={{ marginLeft: 8 }}
            onClick={() => {
              sessionStorage.removeItem(STORAGE_KEY);
              setInfo(defaultInfo());
              setSubmitted(false);
            }}
          >
            Reset form
          </button>
        </div>
      </form>
    </div>
  );
}
