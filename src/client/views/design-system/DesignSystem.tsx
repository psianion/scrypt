import { useStore } from "../../store";
import "./DesignSystem.css";

export function DesignSystem() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  return (
    <div className="ds-root">
      <header className="ds-header">
        <div>
          <h1 className="ds-title">Scrypt Design System</h1>
          <p className="ds-subtitle">Inspector for every primitive × variant × state × theme.</p>
        </div>
        <button className="btn btn-secondary" onClick={toggleTheme} data-testid="ds-theme-toggle">
          Theme: {theme}
        </button>
      </header>
      <main className="ds-main">
        {/* Section slots get filled as primitives land. */}
        <section className="ds-section">
          <h2 className="ds-section-title">Primitives will appear here.</h2>
        </section>
      </main>
    </div>
  );
}
