import { describe, test, expect } from "bun:test";
import { buildOverrideYaml } from "../../src/cli/compose";

describe("buildOverrideYaml", () => {
  test("x64 -> linux/amd64 platform override", () => {
    const yaml = buildOverrideYaml({ ingestDir: "C:\\ingest", arch: "x64" });
    expect(yaml).toContain("platform: linux/amd64");
  });

  test("arm64 -> linux/arm64 platform override", () => {
    const yaml = buildOverrideYaml({ ingestDir: "/data/ingest", arch: "arm64" });
    expect(yaml).toContain("platform: linux/arm64");
  });

  test("mounts the ingest dir read-only and escapes backslashes", () => {
    const yaml = buildOverrideYaml({ ingestDir: "C:\\Users\\me\\ingest", arch: "x64" });
    expect(yaml).toContain('"C:\\\\Users\\\\me\\\\ingest":/ingest:ro');
    expect(yaml).toContain("services:");
    expect(yaml).toContain("scrypt:");
  });
});
