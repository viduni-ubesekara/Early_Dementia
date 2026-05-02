import { Link, Outlet } from "react-router-dom";

export default function SiteLayout() {
  return (
    <>
      <Outlet />
      <footer className="site-footer">
        <div className="app-shell site-footer-inner">
          <div>
            <strong className="site-footer-brand">Cognitive screening</strong>
            <p className="site-footer-note">Research prototype — decision support only, not a medical device.</p>
          </div>
          <nav className="site-footer-nav" aria-label="Footer">
            <Link to="/">Home</Link>
            <Link to="/patient">Start</Link>
            <Link to="/results">Results</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
