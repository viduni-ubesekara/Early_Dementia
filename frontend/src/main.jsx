import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import SiteLayout from "./components/SiteLayout.jsx";
import PatientInfo from "./pages/PatientInfo.jsx";
import MmseTest from "./pages/MmseTest.jsx";
import AdvancedTest from "./pages/AdvancedTest.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<App />} />
          <Route path="/patient" element={<PatientInfo />} />
          <Route path="/test" element={<MmseTest />} />
          <Route path="/test-advanced" element={<AdvancedTest />} />
          <Route path="/results" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
