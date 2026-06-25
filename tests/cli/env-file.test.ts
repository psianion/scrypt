import { describe, test, expect } from "bun:test";
import { parseEnv, getEnv, mergeEnv, serializeEnv, commentOut } from "../../src/cli/env-file";

describe("env-file parse/serialize", () => {
  test("round-trips LF-normalized text exactly", () => {
    const text = "# comment\nFOO=bar\n\nBAZ=qux\n";
    expect(serializeEnv(parseEnv(text))).toBe(text);
  });

  test("splits value on the first = so tokens with = survive", () => {
    const lines = parseEnv("SCRYPT_AUTH_TOKEN=ab=cd==ef");
    expect(getEnv(lines, "SCRYPT_AUTH_TOKEN")).toBe("ab=cd==ef");
  });

  test("preserves comments, blanks, and malformed lines verbatim", () => {
    const text = "# hi\n\nnot a pair line\nKEY=val";
    const lines = parseEnv(text);
    expect(lines[0].key).toBeNull();
    expect(lines[1].key).toBeNull();
    expect(lines[2].key).toBeNull(); // malformed -> preserved, not a pair
    expect(lines[3].key).toBe("KEY");
    expect(serializeEnv(lines)).toBe(text);
  });

  test("empty text parses to empty model", () => {
    expect(parseEnv("")).toEqual([]);
    expect(serializeEnv([])).toBe("");
  });
});

describe("env-file merge (idempotency)", () => {
  test("updates existing key in place, preserves order + comments", () => {
    const lines = parseEnv("# top\nA=1\nB=2\n");
    const r = mergeEnv(lines, { B: "9" });
    expect(r.changed).toBe(true);
    expect(r.updated).toEqual(["B"]);
    expect(r.text).toBe("# top\nA=1\nB=9\n");
  });

  test("appends new keys", () => {
    const lines = parseEnv("A=1");
    const r = mergeEnv(lines, { C: "3" });
    expect(r.added).toEqual(["C"]);
    expect(r.text).toBe("A=1\nC=3");
  });

  test("no-op merge reports changed=false (zero churn on re-run)", () => {
    const lines = parseEnv("A=1\nB=2\n");
    const r = mergeEnv(lines, { A: "1", B: "2" });
    expect(r.changed).toBe(false);
    expect(r.added).toEqual([]);
    expect(r.updated).toEqual([]);
    expect(r.text).toBe("A=1\nB=2\n");
  });

  test("never produces duplicate keys", () => {
    const lines = parseEnv("A=1");
    const r = mergeEnv(lines, { A: "2" });
    const keys = r.lines.filter((l) => l.key === "A");
    expect(keys.length).toBe(1);
    expect(getEnv(r.lines, "A")).toBe("2");
  });
});

describe("env-file commentOut", () => {
  test("comments a stray NODE_ENV=production", () => {
    const lines = parseEnv("NODE_ENV=production\nA=1");
    const r = commentOut(lines, "NODE_ENV");
    expect(r.changed).toBe(true);
    expect(getEnv(r.lines, "NODE_ENV")).toBeUndefined();
    expect(serializeEnv(r.lines)).toBe("# NODE_ENV=production\nA=1");
  });

  test("no-op when key absent", () => {
    const lines = parseEnv("A=1");
    expect(commentOut(lines, "NODE_ENV").changed).toBe(false);
  });
});
