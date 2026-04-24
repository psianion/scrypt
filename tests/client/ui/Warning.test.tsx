import { describe, test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { Warning } from "@/client/ui/Warning";

afterEach(cleanup);

describe("Warning", () => {
  test("renders children with .warning-block class", () => {
    const { getByText } = render(<Warning>Local embeddings are rebuilding.</Warning>);
    const body = getByText("Local embeddings are rebuilding.");
    expect(body.closest(".warning-block")).not.toBeNull();
  });
});
