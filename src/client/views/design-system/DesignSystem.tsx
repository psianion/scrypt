import React from "react";
import {
  Search,
  Command,
  ArrowBigUp,
  CornerDownLeft,
  ArrowUp,
  Folder,
  FileText,
  Pencil,
  Trash2,
  Copy,
  Share2,
} from "lucide-react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Chip, Pill, Kbd, TierChip } from "../../ui/Chip";
import { Toggle } from "../../ui/Toggle";
import { Checkbox } from "../../ui/Checkbox";
import { Segment } from "../../ui/Segment";
import { Warning } from "../../ui/Warning";
import { Modal } from "../../ui/Modal";
import { ToastRegion, useToast } from "../../ui/Toast";
import { ContextMenu, type ContextMenuEntry } from "../../ui/ContextMenu";
import { Breadcrumb } from "../../ui/Breadcrumb";
import "./DesignSystem.css";

export function DesignSystem() {
  return (
    <div className="ds-root">
      <header className="ds-header">
        <div>
          <h1 className="ds-title">Scrypt Design System</h1>
          <p className="ds-subtitle">Inspector for every primitive × variant × state × theme.</p>
        </div>
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
            <Kbd>K</Kbd>
            <Kbd><Command size={14} aria-hidden />K</Kbd>
            <Kbd><Command size={14} aria-hidden /><ArrowBigUp size={14} aria-hidden />P</Kbd>
            <Kbd><CornerDownLeft size={14} aria-hidden /></Kbd>
            <Kbd>Esc</Kbd>
            <Kbd><ArrowUp size={14} aria-hidden /></Kbd>
          </div>
          <div className="ds-row" style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--text-muted)" }}>
            Press&nbsp;<Kbd><Command size={14} aria-hidden />K</Kbd>&nbsp;to open the command palette.
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

        {/* --- Wave 1 primitives (Modal / Toast / ContextMenu / Breadcrumb) --- */}
        <section className="ds-section">
          <h2 className="ds-section-title">Modal</h2>
          <ModalShowcase />
        </section>
        <section className="ds-section">
          <h2 className="ds-section-title">Toast</h2>
          <ToastShowcase />
        </section>
        <section className="ds-section">
          <h2 className="ds-section-title">Context menu</h2>
          <ContextMenuShowcase />
        </section>
        <section className="ds-section">
          <h2 className="ds-section-title">Breadcrumb</h2>
          <BreadcrumbShowcase />
        </section>
        {/* --- end Wave 1 sections --- */}
      </main>
      {/* Region portal-mounted to body; inspector-scoped toasts surface here. */}
      <ToastRegion />
    </div>
  );
}

function ModalShowcase() {
  const [size, setSize] = React.useState<"sm" | "md" | "lg">("md");
  const [open, setOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  return (
    <>
      <p className="ds-subsection-title">Sizes</p>
      <div className="ds-row">
        <Button variant="secondary" onClick={() => { setSize("sm"); setOpen(true); }}>
          Open sm
        </Button>
        <Button variant="secondary" onClick={() => { setSize("md"); setOpen(true); }}>
          Open md
        </Button>
        <Button variant="secondary" onClick={() => { setSize("lg"); setOpen(true); }}>
          Open lg
        </Button>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          Open confirm
        </Button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`New note (${size})`}
        size={size}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>Create</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <Input placeholder="Title" aria-label="modal-title-input" />
          <Input placeholder="#area/ops" aria-label="modal-tags-input" />
        </div>
      </Modal>
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete note?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => setConfirmOpen(false)}>Delete</Button>
          </>
        }
      >
        This will remove <strong>area/ops/sprint-plan.md</strong> and its embeddings. This action cannot be undone.
      </Modal>
    </>
  );
}

function ToastShowcase() {
  const toast = useToast();
  return (
    <>
      <p className="ds-subsection-title">Variants</p>
      <div className="ds-row">
        <Button
          variant="secondary"
          onClick={() => toast.info("Reindex running", { message: "12 of 48 notes processed." })}
        >
          Info
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.success("Note saved", { message: "area/ops/sprint-plan.md" })}
        >
          Success
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.warn("Missing project", { message: "2 notes in #area/ops have no project." })}
        >
          Warn
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.error("Ingest failed", {
              message: "Vault path is not writable.",
              action: { label: "Retry", onClick: () => toast.success("Retried") },
            })
          }
        >
          Error + action
        </Button>
      </div>
    </>
  );
}

function ContextMenuShowcase() {
  const folderItems: ContextMenuEntry[] = [
    { label: "Rename", icon: <Pencil size={14} />, shortcut: "F2", onSelect: () => {} },
    { label: "Duplicate", icon: <Copy size={14} />, shortcut: "⌘D", onSelect: () => {} },
    { label: "Share", icon: <Share2 size={14} />, onSelect: () => {} },
    { separator: true },
    {
      label: "Delete",
      icon: <Trash2 size={14} />,
      shortcut: "⌫",
      variant: "destructive",
      onSelect: () => {},
    },
  ];
  return (
    <>
      <p className="ds-subsection-title">Right-click the folder row</p>
      <ContextMenu
        triggerOn="contextmenu"
        aria-label="Folder actions"
        items={folderItems}
        trigger={
          <div
            className="ds-row"
            style={{
              gap: "var(--space-2)",
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface)",
              color: "var(--text)",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              maxWidth: 260,
              cursor: "context-menu",
              userSelect: "none",
            }}
          >
            <Folder size={14} aria-hidden />
            area/ops
          </div>
        }
      />
    </>
  );
}

function BreadcrumbShowcase() {
  return (
    <>
      <p className="ds-subsection-title">Short path</p>
      <div className="ds-row">
        <Breadcrumb
          items={[
            { label: "vault", href: "/" },
            { label: "area", href: "/folder/area" },
            { label: "ops", href: "/folder/area/ops" },
            { label: "sprint-plan.md", icon: <FileText size={12} aria-hidden /> },
          ]}
        />
      </div>
      <p className="ds-subsection-title">Long path (collapses middle)</p>
      <div className="ds-row">
        <Breadcrumb
          items={[
            { label: "vault", href: "/" },
            { label: "project", href: "/" },
            { label: "scrypt", href: "/" },
            { label: "docs", href: "/" },
            { label: "superpowers", href: "/" },
            { label: "plans", href: "/" },
            { label: "wave1-shell.md", icon: <FileText size={12} aria-hidden /> },
          ]}
        />
      </div>
    </>
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
