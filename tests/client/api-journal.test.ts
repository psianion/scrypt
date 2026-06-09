// tests/client/api-journal.test.ts
import { test, expect } from "bun:test";
import { api } from "../../src/client/api";

test("api.journal exposes entry + calendar + day bundle helpers", () => {
  expect(typeof api.journal.day).toBe("function");
  expect(typeof api.journal.addEntry).toBe("function");
  expect(typeof api.journal.editEntry).toBe("function");
  expect(typeof api.journal.deleteEntry).toBe("function");
  expect(typeof api.journal.calendar).toBe("function");
  expect(typeof api.tasks.create).toBe("function");
  expect(typeof api.tasks.update).toBe("function");
});
