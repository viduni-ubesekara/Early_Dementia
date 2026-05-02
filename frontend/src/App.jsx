import { Link } from "react-router-dom";

export default function App() {
  const startAdaptive = () => {
    sessionStorage.setItem("preferredFlow", "advanced");
  };
  const startLegacy = () => {
    sessionStorage.setItem("preferredFlow", "legacy");
  };

  return (
    <div className="app-shell">
      <div className="tag">Research prototype</div>
      <div className="hero">
        <h1>Cognitive screening &amp; dementia risk — phased fusion</h1>
        <p className="lead">
          <strong>Phase 1</strong> (real-time): per-question reaction times, facial confusion via
          webcam, optional speech analysis. <strong>Phase 2</strong> (after the test): C, B, P are
          computed and the medical ML model predicts M. They are fused into S and classified.
        </p>
        <p className="lead" style={{ fontSize: "0.9rem" }}>
          Fusion: S = 0.40·C + 0.15·B + 0.20·P + 0.25·(100−M), with B = 0.40·reaction +
          0.30·facial + 0.30·speech.
        </p>

        <div
          className="card"
          style={{
            marginTop: "1.2rem",
            background: "linear-gradient(140deg, #ffffff, var(--accent-ghost))",
            borderLeft: "5px solid var(--accent)",
          }}
        >
          <div className="tag" style={{ color: "var(--accent)" }}>
            🆕 Adaptive Sri-Lankan-context session (recommended)
          </div>
          <p style={{ margin: "0.4rem 0 0.8rem" }}>
            Difficulty adapts to your performance. 11 culturally-grounded tasks: festival
            orientation, 3→5→7 adaptive memory, attention game, verbal fluency, Pola memory,
            bus-route logic, trail-making, picture description, festival matching, life-story
            conversation, and self-rated cognition.
          </p>
          <ul
            style={{
              margin: "0.2rem 0 0.8rem 1.2rem",
              padding: 0,
              color: "var(--muted)",
              fontSize: "0.92rem",
              lineHeight: 1.6,
            }}
          >
            <li>🎙️ Voice assistant reads every prompt aloud</li>
            <li>📊 Speech analysed for WPM, pauses, repetition, sentence complexity</li>
            <li>🇱🇰 Sri-Lankan vocabulary: Mango, Bus, Temple → Kottu, Tuk-Tuk, Coconut → Parippu, Bo-tree, Hopper</li>
            <li>🧠 Compares against your previous session if one exists</li>
          </ul>
          <Link
            className="btn btn-primary"
            to="/patient"
            onClick={startAdaptive}
            style={{ fontSize: "1.05rem" }}
          >
            🎮 Start adaptive session →
          </Link>
        </div>

        <details style={{ marginTop: "1rem" }}>
          <summary
            style={{
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: "0.92rem",
              padding: "0.4rem 0",
            }}
          >
            Or use the original static MMSE-style flow
          </summary>
          <div style={{ marginTop: "0.6rem" }}>
            <Link className="btn btn-ghost" to="/patient" onClick={startLegacy}>
              Start legacy MMSE
            </Link>
          </div>
        </details>

        <p style={{ marginTop: "1.2rem" }}>
          <Link className="btn btn-ghost" to="/results">
            Open results (last run)
          </Link>
        </p>

        <p className="lead" style={{ fontSize: "0.85rem", marginTop: "1.4rem", marginBottom: 0 }}>
          Flow: patient information → medical history → cognitive test → fused dashboard.
        </p>
      </div>
    </div>
  );
}
