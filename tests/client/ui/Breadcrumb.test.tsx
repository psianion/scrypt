import { describe, test, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { Breadcrumb, type BreadcrumbItem } from "@/client/ui/Breadcrumb";

afterEach(cleanup);

describe("Breadcrumb", () => {
  test("renders every item when under collapse threshold", () => {
    const items: BreadcrumbItem[] = [
      { label: "Home", href: "/" },
      { label: "Projects", href: "/projects" },
      { label: "Scrypt" },
    ];
    const { getByText } = render(<Breadcrumb items={items} />);
    expect(getByText("Home")).toBeTruthy();
    expect(getByText("Projects")).toBeTruthy();
    expect(getByText("Scrypt")).toBeTruthy();
  });

  test("last item is marked aria-current=page", () => {
    const items: BreadcrumbItem[] = [
      { label: "Home", href: "/" },
      { label: "Leaf" },
    ];
    const { getByText } = render(<Breadcrumb items={items} />);
    const leaf = getByText("Leaf").closest(".breadcrumb-item");
    expect(leaf).toBeTruthy();
    expect(leaf!.getAttribute("aria-current")).toBe("page");
  });

  test("nav has aria-label", () => {
    const { getByRole } = render(
      <Breadcrumb
        items={[{ label: "a" }, { label: "b" }]}
        aria-label="Path"
      />,
    );
    expect(getByRole("navigation").getAttribute("aria-label")).toBe("Path");
  });

  test("separator count equals items.length - 1 (default chevron)", () => {
    const items: BreadcrumbItem[] = [
      { label: "A" },
      { label: "B" },
      { label: "C" },
    ];
    const { container } = render(<Breadcrumb items={items} />);
    expect(container.querySelectorAll(".breadcrumb-sep")).toHaveLength(2);
  });

  test("custom separator is rendered", () => {
    const items: BreadcrumbItem[] = [{ label: "A" }, { label: "B" }];
    const { getByText } = render(
      <Breadcrumb items={items} separator={<span>/</span>} />,
    );
    expect(getByText("/")).toBeTruthy();
  });

  test("item href renders as anchor", () => {
    const items: BreadcrumbItem[] = [
      { label: "Home", href: "/home" },
      { label: "Leaf" },
    ];
    const { getByText } = render(<Breadcrumb items={items} />);
    const home = getByText("Home").closest("a");
    expect(home).toBeTruthy();
    expect(home!.getAttribute("href")).toBe("/home");
  });

  test("item onClick (no href) renders as button and fires", () => {
    let fired = 0;
    const items: BreadcrumbItem[] = [
      { label: "Home", onClick: () => { fired++; } },
      { label: "Leaf" },
    ];
    const { getByText } = render(<Breadcrumb items={items} />);
    const btn = getByText("Home").closest("button");
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(fired).toBe(1);
  });

  test("anchor onClick preempts default nav", () => {
    let fired = 0;
    const items: BreadcrumbItem[] = [
      {
        label: "Home",
        href: "/home",
        onClick: () => { fired++; },
      },
      { label: "Leaf" },
    ];
    const { getByText } = render(<Breadcrumb items={items} />);
    const a = getByText("Home").closest("a")!;
    const ev = new Event("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(fired).toBe(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  test("collapses middle items when count > maxVisible (default 5)", () => {
    const items: BreadcrumbItem[] = [
      { label: "A" },
      { label: "B" },
      { label: "C" },
      { label: "D" },
      { label: "E" },
      { label: "F" },
      { label: "Leaf" },
    ];
    const { container, getByText, queryByText, getByLabelText } = render(
      <Breadcrumb items={items} />,
    );
    // First + last 2 stay visible.
    expect(getByText("A")).toBeTruthy();
    expect(getByText("F")).toBeTruthy();
    expect(getByText("Leaf")).toBeTruthy();
    // Middle hidden.
    expect(queryByText("B")).toBeNull();
    expect(queryByText("C")).toBeNull();
    expect(queryByText("D")).toBeNull();
    expect(queryByText("E")).toBeNull();
    // Ellipsis trigger present with aria-label.
    expect(container.querySelector(".breadcrumb-ellipsis")).toBeTruthy();
    expect(getByLabelText(/4 hidden breadcrumb items/)).toBeTruthy();
  });

  test("ellipsis click opens ContextMenu with hidden items", () => {
    let clickedLabel: string | null = null;
    const items: BreadcrumbItem[] = [
      { label: "A" },
      { label: "B", onClick: () => { clickedLabel = "B"; } },
      { label: "C", onClick: () => { clickedLabel = "C"; } },
      { label: "D", onClick: () => { clickedLabel = "D"; } },
      { label: "E", onClick: () => { clickedLabel = "E"; } },
      { label: "F" },
      { label: "Leaf" },
    ];
    const { container, getByText, queryByRole } = render(
      <Breadcrumb items={items} />,
    );
    expect(queryByRole("menu")).toBeNull();
    const ellipsis = container.querySelector<HTMLButtonElement>(
      ".breadcrumb-ellipsis",
    )!;
    fireEvent.click(ellipsis);
    expect(queryByRole("menu")).toBeTruthy();
    // Hidden items appear in the menu.
    expect(getByText("B")).toBeTruthy();
    expect(getByText("C")).toBeTruthy();
    // Click one → fires underlying onClick.
    fireEvent.click(getByText("C"));
    expect(clickedLabel).toBe("C");
  });

  test("collapse can be disabled", () => {
    const items: BreadcrumbItem[] = Array.from({ length: 8 }, (_, i) => ({
      label: `n${i}`,
    }));
    const { getByText, container } = render(
      <Breadcrumb items={items} collapse={false} />,
    );
    expect(getByText("n3")).toBeTruthy();
    expect(getByText("n4")).toBeTruthy();
    expect(container.querySelector(".breadcrumb-ellipsis")).toBeNull();
  });

  test("custom maxVisible triggers earlier collapse", () => {
    const items: BreadcrumbItem[] = [
      { label: "A" },
      { label: "B" },
      { label: "C" },
      { label: "D" },
    ];
    const { container } = render(<Breadcrumb items={items} maxVisible={3} />);
    expect(container.querySelector(".breadcrumb-ellipsis")).toBeTruthy();
  });
});
