import { describe, test, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { Modal } from "@/client/ui/Modal";

afterEach(cleanup);

describe("Modal", () => {
  test("does not render when closed", () => {
    const { queryByRole } = render(
      <Modal open={false} onClose={() => {}} title="Test">
        <div>body</div>
      </Modal>,
    );
    expect(queryByRole("dialog")).toBeNull();
  });

  test("renders into document.body via portal with title + close button", () => {
    const { getByRole, getByText } = render(
      <Modal open onClose={() => {}} title="Create Note">
        <div>body content</div>
      </Modal>,
    );
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.classList.contains("modal")).toBe(true);
    expect(dialog.classList.contains("modal-md")).toBe(true);
    expect(document.body.contains(dialog)).toBe(true);
    expect(getByText("Create Note")).toBeTruthy();
    expect(getByText("body content")).toBeTruthy();
    expect(getByRole("button", { name: "Close" })).toBeTruthy();
  });

  test("applies size-specific class (sm/md/lg)", () => {
    const { getByRole, rerender } = render(
      <Modal open onClose={() => {}} title="t" size="sm">
        <span />
      </Modal>,
    );
    expect(getByRole("dialog").classList.contains("modal-sm")).toBe(true);
    rerender(
      <Modal open onClose={() => {}} title="t" size="lg">
        <span />
      </Modal>,
    );
    expect(getByRole("dialog").classList.contains("modal-lg")).toBe(true);
  });

  test("Escape key calls onClose", () => {
    let closed = 0;
    render(
      <Modal open onClose={() => { closed++; }} title="t">
        <span />
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closed).toBe(1);
  });

  test("Escape does nothing when dismissOnEscape=false", () => {
    let closed = 0;
    render(
      <Modal open onClose={() => { closed++; }} title="t" dismissOnEscape={false}>
        <span />
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closed).toBe(0);
  });

  test("backdrop mousedown calls onClose", () => {
    let closed = 0;
    const { getByTestId } = render(
      <Modal open onClose={() => { closed++; }} title="t">
        <span>hi</span>
      </Modal>,
    );
    const overlay = getByTestId("modal-overlay");
    fireEvent.mouseDown(overlay);
    expect(closed).toBe(1);
  });

  test("clicking inside the card does not close", () => {
    let closed = 0;
    const { getByText } = render(
      <Modal open onClose={() => { closed++; }} title="t">
        <p>inside</p>
      </Modal>,
    );
    fireEvent.mouseDown(getByText("inside"));
    expect(closed).toBe(0);
  });

  test("backdrop does nothing when dismissOnBackdrop=false", () => {
    let closed = 0;
    const { getByTestId } = render(
      <Modal open onClose={() => { closed++; }} title="t" dismissOnBackdrop={false}>
        <span />
      </Modal>,
    );
    fireEvent.mouseDown(getByTestId("modal-overlay"));
    expect(closed).toBe(0);
  });

  test("close button fires onClose", () => {
    let closed = 0;
    const { getByRole } = render(
      <Modal open onClose={() => { closed++; }} title="t">
        <span />
      </Modal>,
    );
    fireEvent.click(getByRole("button", { name: "Close" }));
    expect(closed).toBe(1);
  });

  test("hideCloseButton hides the X button", () => {
    const { queryByRole } = render(
      <Modal open onClose={() => {}} title="t" hideCloseButton>
        <span />
      </Modal>,
    );
    expect(queryByRole("button", { name: "Close" })).toBeNull();
  });

  test("focus trap cycles Tab → first element, Shift+Tab → last element", () => {
    const { getByRole, getByTestId } = render(
      <Modal open onClose={() => {}} title="t">
        <input data-testid="first" />
        <input data-testid="middle" />
        <input data-testid="last" />
      </Modal>,
    );
    const first = getByTestId("first") as HTMLInputElement;
    const last = getByTestId("last") as HTMLInputElement;
    // Focus should already be on the first focusable element (the close button)
    const closeBtn = getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(closeBtn);

    // Move focus to the last element and tab forward — should wrap to first focusable (close btn)
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab from first focusable → last focusable
    closeBtn.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Silence unused warning on `first`
    expect(first).toBeTruthy();
  });

  test("locks body scroll while open and restores on close", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(false)}>close</button>
          <Modal open={open} onClose={() => setOpen(false)} title="t">
            <span />
          </Modal>
        </>
      );
    }
    const { getByText } = render(<Harness />);
    expect(document.body.style.overflow).toBe("hidden");
    act(() => {
      fireEvent.click(getByText("close"));
    });
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  test("restores focus to previously focused element on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="trigger" onClick={() => setOpen(true)}>open</button>
          <Modal open={open} onClose={() => setOpen(false)} title="t">
            <span />
          </Modal>
        </>
      );
    }
    const { getByTestId, getByRole } = render(<Harness />);
    const trigger = getByTestId("trigger") as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    act(() => {
      fireEvent.click(trigger);
    });
    // Close via Escape
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    // After close, focus returns to trigger.
    expect(document.activeElement).toBe(trigger);
    // dialog gone
    expect(() => getByRole("dialog")).toThrow();
  });

  test("renders footer when provided", () => {
    const { getByText } = render(
      <Modal open onClose={() => {}} title="t" footer={<button>Save</button>}>
        <span />
      </Modal>,
    );
    expect(getByText("Save")).toBeTruthy();
  });

  test("uses ariaLabel when no title provided", () => {
    const { getByRole } = render(
      <Modal open onClose={() => {}} ariaLabel="Confirm delete">
        <span />
      </Modal>,
    );
    expect(getByRole("dialog").getAttribute("aria-label")).toBe("Confirm delete");
  });
});
