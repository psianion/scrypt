import { useState } from "react";
import { useNavigate } from "react-router";
import { Modal } from "@/client/ui/Modal";
import { Input } from "@/client/ui/Input";
import { Button } from "@/client/ui/Button";
import "./NewNoteModal.css";

interface NewNoteModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * NewNoteModal — wraps the create-note form in the Wave 1 `<Modal>` primitive.
 * Same prop contract as before (`open`, `onClose`) so callers don't need to
 * change. Inputs use the Wave 0 `<Input>` primitive; actions use `<Button>`.
 * Layout chrome lives in NewNoteModal.css using design tokens.
 */
export function NewNoteModal({ open, onClose }: NewNoteModalProps) {
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

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
    <Modal
      open={open}
      onClose={onClose}
      title="New note"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            Create &amp; open
          </Button>
        </>
      }
    >
      <div className="new-note-form">
        <label className="new-note-field">
          <span className="new-note-label">Title</span>
          <Input
            aria-label="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="new-note-grid">
          <label className="new-note-field">
            <span className="new-note-label">Domain</span>
            <Input
              aria-label="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </label>
          <label className="new-note-field">
            <span className="new-note-label">Subdomain</span>
            <Input
              aria-label="subdomain"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
            />
          </label>
        </div>
        <label className="new-note-field">
          <span className="new-note-label">Tags (comma-separated)</span>
          <Input
            aria-label="tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="type:research, project:longrest, landing-page"
          />
        </label>
        <label className="new-note-field">
          <span className="new-note-label">Content (markdown)</span>
          <textarea
            aria-label="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="new-note-textarea"
          />
        </label>
        {error ? (
          <div className="new-note-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
