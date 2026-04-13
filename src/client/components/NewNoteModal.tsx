import { useState } from "react";
import { useNavigate } from "react-router";

interface NewNoteModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewNoteModal({ open, onClose }: NewNoteModalProps) {
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  if (!open) return null;

  const canSubmit = title.trim().length > 0;

  async function submit() {
    setError(null);
    const tags = tagsInput
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const frontmatter: Record<string, unknown> = {};
    if (domain.trim()) frontmatter.domain = domain.trim();
    if (subdomain.trim()) frontmatter.subdomain = subdomain.trim();
    if (tags.length > 0) frontmatter.tags = tags;

    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        content: content || `# ${title.trim()}\n`,
        frontmatter,
      }),
    });
    if (!res.ok) {
      setError(`${res.status}: ${await res.text()}`);
      return;
    }
    const { path } = (await res.json()) as { path: string };
    onClose();
    navigate(`/note/${path}`);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded p-6 w-[480px] space-y-3 text-[var(--text-primary)]">
        <h2 className="text-lg">New note</h2>
        <label className="block">
          <span className="text-xs uppercase text-[var(--text-muted)]">Title</span>
          <input
            aria-label="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs uppercase text-[var(--text-muted)]">Domain</span>
            <input
              aria-label="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase text-[var(--text-muted)]">Subdomain</span>
            <input
              aria-label="subdomain"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs uppercase text-[var(--text-muted)]">Tags (comma-separated)</span>
          <input
            aria-label="tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="type:research, project:longrest, landing-page"
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase text-[var(--text-muted)]">Content (markdown)</span>
          <textarea
            aria-label="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 font-mono text-sm"
          />
        </label>
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1 text-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-3 py-1 text-sm bg-[var(--accent)] text-black disabled:opacity-50"
          >
            Create & open
          </button>
        </div>
      </div>
    </div>
  );
}
