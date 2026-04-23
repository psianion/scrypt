import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  buildProjectTree,
  deriveProjectDocType,
  type FolderTreeNote,
} from "../../src/client/components/FolderTree.helpers";
import { FolderTree } from "../../src/client/components/FolderTree";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("deriveProjectDocType", () => {
  test("extracts project + doc_type from projects/<p>/<dt>/<slug>.md", () => {
    expect(deriveProjectDocType("projects/dbtmg/plan/a.md")).toEqual({
      project: "dbtmg",
      doc_type: "plan",
    });
  });

  test("returns nulls for non-project paths", () => {
    expect(deriveProjectDocType("journal/2026-04-13.md")).toEqual({
      project: null,
      doc_type: null,
    });
  });
});

describe("buildProjectTree", () => {
  test("groups notes by project → doc_type", () => {
    const notes: FolderTreeNote[] = [
      { path: "projects/dbtmg/plan/a.md", title: "A", project: "dbtmg", doc_type: "plan" },
      { path: "projects/dbtmg/spec/b.md", title: "B", project: "dbtmg", doc_type: "spec" },
      { path: "projects/_inbox/research/c.md", title: "C", project: "_inbox", doc_type: "research" },
    ];
    const groups = buildProjectTree(notes);
    expect(groups.map((g) => g.project)).toEqual(["_inbox", "dbtmg"]);
    const dbtmg = groups.find((g) => g.project === "dbtmg")!;
    expect([...dbtmg.docTypes.keys()].sort()).toEqual(["plan", "spec"]);
    expect(dbtmg.total).toBe(2);
  });

  test("_inbox pins first, then alphabetical", () => {
    const notes: FolderTreeNote[] = [
      { path: "projects/zulu/plan/z.md", title: "Z", project: "zulu", doc_type: "plan" },
      { path: "projects/alpha/plan/a.md", title: "A", project: "alpha", doc_type: "plan" },
      { path: "projects/_inbox/research/i.md", title: "I", project: "_inbox", doc_type: "research" },
    ];
    const groups = buildProjectTree(notes);
    expect(groups.map((g) => g.project)).toEqual(["_inbox", "alpha", "zulu"]);
  });

  test("derives project + doc_type from path when fields missing", () => {
    const notes: FolderTreeNote[] = [
      { path: "projects/dbtmg/plan/a.md", title: "A" }, // no project/doc_type set
    ];
    const groups = buildProjectTree(notes);
    expect(groups[0]?.project).toBe("dbtmg");
    expect([...groups[0]!.docTypes.keys()]).toEqual(["plan"]);
  });

  test("skips reserved top-level folders (journal, data, assets, .scrypt, dist)", () => {
    const notes: FolderTreeNote[] = [
      { path: "journal/2026-04-13.md", title: "J" },
      { path: "data/foo.csv", title: "D" },
      { path: "assets/x.png", title: "X" },
      { path: ".scrypt/cache.db", title: "S" },
      { path: "dist/bundle.js", title: "B" },
      { path: "projects/dbtmg/plan/a.md", title: "A", project: "dbtmg", doc_type: "plan" },
    ];
    const groups = buildProjectTree(notes);
    expect(groups.map((g) => g.project)).toEqual(["dbtmg"]);
  });

  test("thread filter keeps only matching (project, thread) notes", () => {
    const notes: FolderTreeNote[] = [
      { path: "projects/dbtmg/plan/a.md", title: "A", project: "dbtmg", doc_type: "plan", thread: "news-images" },
      { path: "projects/dbtmg/spec/b.md", title: "B", project: "dbtmg", doc_type: "spec", thread: "news-images" },
      { path: "projects/dbtmg/plan/c.md", title: "C", project: "dbtmg", doc_type: "plan", thread: "auth" },
    ];
    const groups = buildProjectTree(notes, {
      thread: { project: "dbtmg", thread: "news-images" },
    });
    expect(groups[0]!.total).toBe(2);
    const titles: string[] = [];
    for (const ns of groups[0]!.docTypes.values()) for (const n of ns) titles.push(n.title!);
    expect(titles.sort()).toEqual(["A", "B"]);
  });

  test("sorts notes by title within each doc_type", () => {
    const notes: FolderTreeNote[] = [
      { path: "projects/p/plan/z.md", title: "Zebra", project: "p", doc_type: "plan" },
      { path: "projects/p/plan/a.md", title: "Apple", project: "p", doc_type: "plan" },
      { path: "projects/p/plan/m.md", title: "Mango", project: "p", doc_type: "plan" },
    ];
    const groups = buildProjectTree(notes);
    const titles = groups[0]!.docTypes.get("plan")!.map((n) => n.title);
    expect(titles).toEqual(["Apple", "Mango", "Zebra"]);
  });
});

const NOTES: FolderTreeNote[] = [
  { path: "projects/dbtmg/plan/a.md", title: "A", project: "dbtmg", doc_type: "plan" },
  { path: "projects/dbtmg/spec/b.md", title: "B", project: "dbtmg", doc_type: "spec" },
  { path: "projects/_inbox/research/c.md", title: "C", project: "_inbox", doc_type: "research" },
];

describe("FolderTree render", () => {
  test("renders project → doc_type hierarchy", () => {
    render(<FolderTree notes={NOTES} />);
    expect(screen.getByText("_inbox")).toBeDefined();
    expect(screen.getByText("dbtmg")).toBeDefined();
    expect(screen.getByText("plan")).toBeDefined();
    expect(screen.getByText("spec")).toBeDefined();
  });

  test("empty doc_type buckets are hidden by default", () => {
    render(<FolderTree notes={NOTES} />);
    expect(screen.queryByText("architecture")).toBeNull();
    expect(screen.queryByText("sessionlog")).toBeNull();
  });

  test("_inbox is pinned to top with badge count", () => {
    const { container } = render(<FolderTree notes={NOTES} />);
    const firstProject = container.querySelector("[data-project]");
    expect(firstProject?.getAttribute("data-project")).toBe("_inbox");
    expect(screen.getByText("_inbox").parentElement?.textContent).toMatch(/1/);
  });

  test("show-all-types toggle reveals empty buckets under each project", () => {
    const { rerender, container } = render(
      <FolderTree notes={NOTES} showAllTypes={false} />,
    );
    expect(screen.queryByText("architecture")).toBeNull();
    rerender(<FolderTree notes={NOTES} showAllTypes={true} />);
    // All 9 DOC_TYPES should now have rows under each project.
    const dbtmg = container.querySelector('[data-project="dbtmg"]')!;
    const docTypeRows = dbtmg.querySelectorAll("[data-doc-type]");
    expect(docTypeRows.length).toBe(9);
  });

  test("clicking a note calls onNoteClick with the note path", () => {
    const clicks: string[] = [];
    render(
      <FolderTree
        notes={NOTES}
        onNoteClick={(p) => clicks.push(p)}
      />,
    );
    // Expand the "plan" doc_type under dbtmg.
    const planRow = screen.getAllByText("plan")[0]!;
    fireEvent.click(planRow);
    // Click the note link.
    fireEvent.click(screen.getByText("A"));
    expect(clicks).toEqual(["projects/dbtmg/plan/a.md"]);
  });

  test("empty vault state shows drop hint", () => {
    render(<FolderTree notes={[]} />);
    expect(screen.getByText(/drop a markdown file/i)).toBeDefined();
  });

  test("thread prop filters the tree to thread members", () => {
    const notes: FolderTreeNote[] = [
      { path: "projects/p/plan/a.md", title: "A", project: "p", doc_type: "plan", thread: "t1" },
      { path: "projects/p/plan/b.md", title: "B", project: "p", doc_type: "plan", thread: "t2" },
    ];
    render(
      <FolderTree notes={notes} thread={{ project: "p", thread: "t1" }} />,
    );
    // Expand "plan"
    fireEvent.click(screen.getByText("plan"));
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.queryByText("B")).toBeNull();
  });
});
