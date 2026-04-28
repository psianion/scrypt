import { describe, test, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "@/client/ui/ContextMenu";

afterEach(cleanup);

function makeItems(onSelect: (id: string) => void): ContextMenuEntry[] {
  return [
    { id: "rename", label: "Rename", shortcut: "F2", onSelect: () => onSelect("rename") },
    { id: "move", label: "Move to…", onSelect: () => onSelect("move") },
    { separator: true },
    {
      id: "delete",
      label: "Delete",
      variant: "destructive",
      shortcut: "⌘⌫",
      onSelect: () => onSelect("delete"),
    },
  ];
}

describe("ContextMenu", () => {
  test("controlled: renders items when open", () => {
    const { getByRole, getAllByRole } = render(
      <ContextMenu
        open
        position={{ x: 100, y: 100 }}
        items={makeItems(() => {})}
        onClose={() => {}}
      />,
    );
    expect(getByRole("menu")).toBeTruthy();
    expect(getAllByRole("menuitem")).toHaveLength(3);
  });

  test("controlled: hidden when open=false", () => {
    const { queryByRole } = render(
      <ContextMenu
        open={false}
        position={{ x: 0, y: 0 }}
        items={makeItems(() => {})}
        onClose={() => {}}
      />,
    );
    expect(queryByRole("menu")).toBeNull();
  });

  test("first selectable item starts active", () => {
    const { getAllByRole } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={makeItems(() => {})}
        onClose={() => {}}
      />,
    );
    const items = getAllByRole("menuitem");
    expect(items[0]!.getAttribute("data-active")).toBe("true");
  });

  test("ArrowDown moves active marker and wraps", () => {
    const { getByRole, getAllByRole } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={makeItems(() => {})}
        onClose={() => {}}
      />,
    );
    const menu = getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    let items = getAllByRole("menuitem");
    expect(items[1]!.getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    items = getAllByRole("menuitem");
    expect(items[2]!.getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    items = getAllByRole("menuitem");
    // wraps back to first
    expect(items[0]!.getAttribute("data-active")).toBe("true");
  });

  test("ArrowUp from first wraps to last", () => {
    const { getByRole, getAllByRole } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={makeItems(() => {})}
        onClose={() => {}}
      />,
    );
    fireEvent.keyDown(getByRole("menu"), { key: "ArrowUp" });
    const items = getAllByRole("menuitem");
    expect(items[2]!.getAttribute("data-active")).toBe("true");
  });

  test("Enter fires active item onSelect and closes", () => {
    let selected: string | null = null;
    let closed = 0;
    const { getByRole } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={makeItems((id) => {
          selected = id;
        })}
        onClose={() => {
          closed++;
        }}
      />,
    );
    fireEvent.keyDown(getByRole("menu"), { key: "Enter" });
    expect(selected).toBe("rename");
    expect(closed).toBe(1);
  });

  test("click fires item onSelect and closes", () => {
    let selected: string | null = null;
    let closed = 0;
    const { getByText } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={makeItems((id) => {
          selected = id;
        })}
        onClose={() => {
          closed++;
        }}
      />,
    );
    fireEvent.click(getByText("Move to…"));
    expect(selected).toBe("move");
    expect(closed).toBe(1);
  });

  test("Escape calls onClose", () => {
    let closed = 0;
    const { getByRole } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={makeItems(() => {})}
        onClose={() => {
          closed++;
        }}
      />,
    );
    fireEvent.keyDown(getByRole("menu"), { key: "Escape" });
    expect(closed).toBe(1);
  });

  test("destructive variant applies danger class", () => {
    const { getByText } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={makeItems(() => {})}
        onClose={() => {}}
      />,
    );
    const deleteItem = getByText("Delete").closest(".context-menu-item");
    expect(deleteItem).toBeTruthy();
    expect(deleteItem!.classList.contains("danger")).toBe(true);
    expect(deleteItem!.getAttribute("data-variant")).toBe("destructive");
  });

  test("shortcut renders inside Kbd", () => {
    const { getByText } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={makeItems(() => {})}
        onClose={() => {}}
      />,
    );
    const kbd = getByText("⌘⌫");
    expect(kbd.classList.contains("kbd")).toBe(true);
  });

  test("disabled item ignores click and Enter", () => {
    let selected = 0;
    const items: ContextMenuEntry[] = [
      { id: "a", label: "Active", onSelect: () => { selected++; } },
      { id: "d", label: "Disabled", disabled: true, onSelect: () => { selected++; } },
    ];
    const { getByText, getByRole } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={items}
        onClose={() => {}}
      />,
    );
    fireEvent.click(getByText("Disabled"));
    expect(selected).toBe(0);
    // Enter on initially-active (non-disabled) does fire.
    fireEvent.keyDown(getByRole("menu"), { key: "Enter" });
    expect(selected).toBe(1);
  });

  test("separator renders with role=separator", () => {
    const { getAllByRole } = render(
      <ContextMenu
        open
        position={{ x: 0, y: 0 }}
        items={makeItems(() => {})}
        onClose={() => {}}
      />,
    );
    expect(getAllByRole("separator")).toHaveLength(1);
  });

  test("trigger form: right-click opens menu", () => {
    const { getByTestId, queryByRole, getByRole } = render(
      <ContextMenu
        trigger={<button data-testid="t">target</button>}
        items={makeItems(() => {})}
      />,
    );
    expect(queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(getByTestId("t"), { clientX: 50, clientY: 50 });
    expect(getByRole("menu")).toBeTruthy();
  });

  test("trigger form: click mode opens on click", () => {
    const { getByTestId, getByRole } = render(
      <ContextMenu
        triggerOn="click"
        trigger={<button data-testid="t">target</button>}
        items={makeItems(() => {})}
      />,
    );
    fireEvent.click(getByTestId("t"), { clientX: 10, clientY: 10 });
    expect(getByRole("menu")).toBeTruthy();
  });
});
