import React from "react";
import { Search } from "lucide-react";
import { useStore } from "../../store";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Chip, Pill, Kbd, TierChip } from "../../ui/Chip";
import { Toggle } from "../../ui/Toggle";
import { Checkbox } from "../../ui/Checkbox";
import { Segment } from "../../ui/Segment";
import { Warning } from "../../ui/Warning";
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

        <section className="ds-section">
          <h2 className="ds-section-title">Inputs</h2>
          <div className="ds-row" style={{ maxWidth: 360 }}>
            <Input placeholder="Default input" aria-label="default" />
          </div>
          <div className="ds-row" style={{ maxWidth: 360 }}>
            <Input placeholder="Search notes…" aria-label="search" icon={<Search size={14} aria-hidden />} />
          </div>
          <div className="ds-row" style={{ maxWidth: 360 }}>
            <Input defaultValue="invalid@" aria-label="err" error="Not a valid email" />
          </div>
          <div className="ds-row" style={{ maxWidth: 360 }}>
            <Input placeholder="Disabled" aria-label="dis" disabled />
          </div>
        </section>

        <section className="ds-section">
          <h2 className="ds-section-title">Chips, Pills, Kbd, Tiers</h2>
          <p className="ds-subsection-title">Chip variants</p>
          <div className="ds-row">
            <Chip>default</Chip>
            <Chip variant="tag">#area/ops</Chip>
            <Chip variant="status-done">done</Chip>
            <Chip variant="status-review">review</Chip>
            <Chip variant="status-blocked">blocked</Chip>
            <Chip variant="status-ai">ai</Chip>
            <Chip variant="tag" onRemove={() => {}}>removable</Chip>
          </div>
          <p className="ds-subsection-title">Pill</p>
          <div className="ds-row">
            <Pill>5 notes</Pill>
            <Pill>12 tasks</Pill>
          </div>
          <p className="ds-subsection-title">Kbd</p>
          <div className="ds-row">
            <Kbd>⌘K</Kbd>
            <Kbd>⌘N</Kbd>
            <Kbd>Esc</Kbd>
          </div>
          <p className="ds-subsection-title">Tier chips</p>
          <div className="ds-row">
            <TierChip tier="connected">CONNECTED</TierChip>
            <TierChip tier="mentions">MENTIONS</TierChip>
            <TierChip tier="semantic">SEMANTIC</TierChip>
          </div>
        </section>

        {/* --- primitives-b sections (Toggle / Checkbox / Segment / Warning) --- */}
        <section className="ds-section">
          <h2 className="ds-section-title">Toggle</h2>
          <ToggleShowcase />
        </section>
        <section className="ds-section">
          <h2 className="ds-section-title">Checkbox</h2>
          <CheckboxShowcase />
        </section>
        <section className="ds-section">
          <h2 className="ds-section-title">Segment control</h2>
          <SegmentShowcase />
        </section>
        <section className="ds-section">
          <h2 className="ds-section-title">Warning block</h2>
          <div className="ds-row" style={{ flexDirection: "column", alignItems: "stretch", maxWidth: 520 }}>
            <Warning>Local embeddings are rebuilding — semantic search results may be incomplete.</Warning>
            <Warning>Some notes in <strong>#area/ops</strong> are missing a <code>project</code> assignment.</Warning>
          </div>
        </section>
        {/* --- end primitives-b sections --- */}
      </main>
    </div>
  );
}

function ToggleShowcase() {
  const [on, setOn] = React.useState(false);
  return (
    <div className="ds-row">
      <Toggle checked={on} onChange={setOn} aria-label="demo" />
      <Toggle checked aria-label="always-on" onChange={() => {}} />
      <Toggle checked={false} disabled aria-label="dis-off" onChange={() => {}} />
      <Toggle checked disabled aria-label="dis-on" onChange={() => {}} />
    </div>
  );
}

function CheckboxShowcase() {
  const [on, setOn] = React.useState(false);
  return (
    <div className="ds-row">
      <Checkbox checked={on} onChange={setOn} aria-label="demo" />
      <Checkbox checked aria-label="on" onChange={() => {}} />
      <Checkbox checked={false} disabled aria-label="dis-off" onChange={() => {}} />
      <Checkbox checked disabled aria-label="dis-on" onChange={() => {}} />
    </div>
  );
}

function SegmentShowcase() {
  const [v, setV] = React.useState<"list" | "grid" | "kanban">("list");
  return (
    <div className="ds-row">
      <Segment
        items={[
          { value: "list", label: "List" },
          { value: "grid", label: "Grid" },
          { value: "kanban", label: "Kanban" },
        ] as const}
        value={v}
        onChange={setV}
        ariaLabel="view mode"
      />
    </div>
  );
}
