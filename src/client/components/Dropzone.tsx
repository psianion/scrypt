import { useState, type ReactNode } from "react";
import matter from "gray-matter";

interface DropzoneProps {
  children: ReactNode;
  onFilesDropped?: (count: number, errors: string[]) => void;
}

export function Dropzone({ children, onFilesDropped }: DropzoneProps) {
  const [isOver, setIsOver] = useState(false);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsOver(false);
    const files = Array.from(e.dataTransfer.files);
    const errors: string[] = [];
    let count = 0;
    for (const file of files) {
      if (file.name.endsWith(".md")) {
        try {
          const text = await file.text();
          const parsed = matter(text);
          const res = await fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: parsed.data.title ?? file.name.replace(/\.md$/, ""),
              content: parsed.content,
              frontmatter: parsed.data,
            }),
          });
          if (!res.ok) errors.push(`${file.name}: ${res.status}`);
          else count++;
        } catch (err) {
          errors.push(`${file.name}: ${(err as Error).message}`);
        }
      } else if (/\.(png|jpe?g|gif|webp|pdf)$/i.test(file.name)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) errors.push(`${file.name}: ${res.status}`);
        else count++;
      } else {
        errors.push(`${file.name}: unsupported type`);
      }
    }
    onFilesDropped?.(count, errors);
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsOver(false);
      }}
      onDrop={handleDrop}
      className="relative h-full"
    >
      {children}
      {isOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/90 border-2 border-dashed border-[var(--text-primary)] pointer-events-none">
          <div className="text-lg text-[var(--text-primary)]">
            Drop to add notes — will be routed by frontmatter
          </div>
        </div>
      )}
    </div>
  );
}
