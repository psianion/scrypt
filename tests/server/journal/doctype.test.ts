// tests/server/journal/doctype.test.ts
import { test, expect } from "bun:test";
import { setup } from "./api.test";

// C6: reindexNote does NOT derive doc_type for top-level journal/ files.
// The journal route stamps it in persist() after reindex, so we POST an entry
// via the route and then assert notes.doc_type = 'journal'.
test("posting a journal entry stamps notes.doc_type = journal", async () => {
  const { router, db } = setup();
  const post = await router.handle(
    new Request("http://x/api/journal/2026-06-09/entries", {
      method: "POST",
      body: JSON.stringify({ body: "x" }),
    }),
  )!;
  expect(post.status).toBe(200);

  const row = db
    .query("SELECT doc_type FROM notes WHERE path = ?")
    .get("journal/2026-06-09.md") as { doc_type: string | null } | null;
  expect(row?.doc_type).toBe("journal");
});
