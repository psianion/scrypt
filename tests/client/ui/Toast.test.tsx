import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, fireEvent, cleanup, act, renderHook } from "@testing-library/react";
import { Toast, ToastRegion, useToast } from "@/client/ui/Toast";
import { useToastStore } from "@/client/stores/toast";

afterEach(cleanup);
beforeEach(() => {
  useToastStore.getState().clear();
});

describe("useToastStore", () => {
  test("enqueue assigns an id and appends to the queue", () => {
    const id = useToastStore.getState().enqueue({
      variant: "success",
      title: "Saved",
    });
    expect(typeof id).toBe("string");
    expect(useToastStore.getState().toasts.length).toBe(1);
    expect(useToastStore.getState().toasts[0]!.title).toBe("Saved");
  });

  test("dismiss removes the toast by id", () => {
    const id = useToastStore.getState().enqueue({
      variant: "info",
      title: "hello",
    });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts.length).toBe(0);
  });

  test("info/success/warn default to 4000ms duration; error defaults to 0 (sticky)", () => {
    const a = useToastStore.getState().enqueue({ variant: "info", title: "i" });
    const b = useToastStore.getState().enqueue({ variant: "error", title: "e" });
    const toasts = useToastStore.getState().toasts;
    const A = toasts.find((t) => t.id === a)!;
    const B = toasts.find((t) => t.id === b)!;
    expect(A.durationMs).toBe(4000);
    expect(B.durationMs).toBe(0);
  });

  test("explicit durationMs overrides defaults", () => {
    const id = useToastStore.getState().enqueue({
      variant: "error",
      title: "oops",
      durationMs: 1000,
    });
    const rec = useToastStore.getState().toasts.find((t) => t.id === id)!;
    expect(rec.durationMs).toBe(1000);
  });
});

describe("useToast hook", () => {
  test("exposes variant shortcuts and enqueues through the store", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.success("Done");
    });
    const snapshot = useToastStore.getState().toasts;
    expect(snapshot.length).toBe(1);
    expect(snapshot[0]!.variant).toBe("success");
    expect(snapshot[0]!.title).toBe("Done");
  });

  test("error toast with action stays sticky and calls onClick when pressed", () => {
    const { result } = renderHook(() => useToast());
    let retried = 0;
    let id = "";
    act(() => {
      id = result.current.error("Failed", {
        message: "Network error",
        action: { label: "Retry", onClick: () => { retried++; } },
      });
    });
    const rec = useToastStore.getState().toasts.find((t) => t.id === id)!;
    expect(rec.durationMs).toBe(0);
    expect(rec.message).toBe("Network error");
    expect(rec.action?.label).toBe("Retry");
    rec.action!.onClick();
    expect(retried).toBe(1);
  });

  test("dismiss removes the toast", () => {
    const { result } = renderHook(() => useToast());
    let id = "";
    act(() => {
      id = result.current.info("hello");
    });
    act(() => {
      result.current.dismiss(id);
    });
    expect(useToastStore.getState().toasts.length).toBe(0);
  });
});

describe("<Toast />", () => {
  test("renders title, message, and variant-specific class + icon color", () => {
    const { getByText, getByTestId } = render(
      <Toast
        id="t1"
        variant="success"
        title="Saved"
        message="All changes flushed"
        onDismiss={() => {}}
      />,
    );
    const el = getByTestId("toast-t1");
    expect(el.classList.contains("toast-success")).toBe(true);
    expect(el.getAttribute("data-variant")).toBe("success");
    expect(getByText("Saved")).toBeTruthy();
    expect(getByText("All changes flushed")).toBeTruthy();
  });

  test("error variant uses role=alert for screen readers", () => {
    const { getByTestId } = render(
      <Toast id="e1" variant="error" title="Broken" onDismiss={() => {}} />,
    );
    expect(getByTestId("toast-e1").getAttribute("role")).toBe("alert");
  });

  test("non-error variants use role=status", () => {
    const { getByTestId } = render(
      <Toast id="s1" variant="info" title="Hi" onDismiss={() => {}} />,
    );
    expect(getByTestId("toast-s1").getAttribute("role")).toBe("status");
  });

  test("clicking dismiss button calls onDismiss with id", () => {
    let dismissed = "";
    const { getByRole } = render(
      <Toast
        id="dx"
        variant="info"
        title="Hi"
        onDismiss={(id) => { dismissed = id; }}
      />,
    );
    fireEvent.click(getByRole("button", { name: "Dismiss notification" }));
    expect(dismissed).toBe("dx");
  });

  test("action button triggers onClick and auto-dismisses", () => {
    let dismissed = "";
    let clicked = 0;
    const { getByText } = render(
      <Toast
        id="a1"
        variant="warn"
        title="Unsaved"
        action={{ label: "Save", onClick: () => { clicked++; } }}
        onDismiss={(id) => { dismissed = id; }}
      />,
    );
    fireEvent.click(getByText("Save"));
    expect(clicked).toBe(1);
    expect(dismissed).toBe("a1");
  });
});

describe("<ToastRegion />", () => {
  test("renders queued toasts, mounted to document.body", () => {
    const { getByTestId } = render(<ToastRegion />);
    act(() => {
      useToastStore.getState().enqueue({ variant: "info", title: "Hello" });
    });
    const region = getByTestId("toast-region");
    expect(region.getAttribute("aria-label")).toBe("Notifications");
    expect(document.body.contains(region)).toBe(true);
    const toasts = region.querySelectorAll(".toast");
    expect(toasts.length).toBe(1);
  });

  test("auto-dismisses after durationMs using fake timers", () => {
    let realSetTimeout = global.setTimeout;
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    (global as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: () => void,
      ms: number,
    ) => {
      scheduled.push({ fn, ms });
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    try {
      render(<ToastRegion />);
      act(() => {
        useToastStore
          .getState()
          .enqueue({ variant: "success", title: "Saved", durationMs: 1500 });
      });
      expect(useToastStore.getState().toasts.length).toBe(1);
      const task = scheduled.find((s) => s.ms === 1500);
      expect(task).toBeTruthy();
      act(() => {
        task!.fn();
      });
      expect(useToastStore.getState().toasts.length).toBe(0);
    } finally {
      (global as unknown as { setTimeout: typeof setTimeout }).setTimeout = realSetTimeout;
    }
  });

  test("sticky toasts (durationMs=0) do not schedule auto-dismiss", () => {
    const scheduled: number[] = [];
    const realSetTimeout = global.setTimeout;
    (global as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: () => void,
      ms: number,
    ) => {
      scheduled.push(ms);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    try {
      render(<ToastRegion />);
      act(() => {
        useToastStore.getState().enqueue({ variant: "error", title: "Bad" });
      });
      // No timer scheduled for the sticky error toast.
      expect(scheduled.length).toBe(0);
    } finally {
      (global as unknown as { setTimeout: typeof setTimeout }).setTimeout = realSetTimeout;
    }
  });
});
