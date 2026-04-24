import { useStore } from "../../store";
import { Button } from "../../ui/Button";
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
        <section className="ds-section">
          <h2 className="ds-section-title">Buttons</h2>
          <p className="ds-subsection-title">Variants</p>
          <div className="ds-row">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="ai">AI</Button>
          </div>
          <p className="ds-subsection-title">States</p>
          <div className="ds-row">
            <Button>Default</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
          </div>
        </section>
      </main>
    </div>
  );
}
