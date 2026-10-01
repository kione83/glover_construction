import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
vi.mock("react-native", () => ({ Text: "Text", TextInput: "TextInput", View: "View", Pressable: "Pressable", ScrollView: "ScrollView", StyleSheet: { create: (value: any) => value } }));
import { CatalogBrowser } from "./CatalogBrowser";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === "string" ? child : text(child)).join("");
const button = (label: string) => renderer.root.findAllByType("Pressable" as any).find(node => text(node) === label)!;
describe("catalog selection", () => {
  it("filters, recovers from no results and selects a real catalog item", async () => {
    const select = vi.fn();
    await act(async () => { renderer = create(<CatalogBrowser onSelect={select} />); });
    await act(async () => button("Electrical").props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: "Search catalog" }).props.onChangeText("sofa"));
    expect(text(renderer.root)).toContain("No products match");
    await act(async () => button("Clear catalog filters").props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: "Select Sofa" }).props.onPress());
    expect(select).toHaveBeenCalledWith("furniture-sofa");
  });
  it("keeps selected product metadata visible while filtering in compact AR mode", async () => {
    await act(async () => { renderer = create(<CatalogBrowser compact selectedId="furniture-sofa" onSelect={() => {}} />); });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: "Search catalog" }).props.onChangeText("no-match"));
    expect(text(renderer.root)).toContain("Selected: Sofa");
    expect(text(renderer.root)).toContain("Width 2.1 × height 0.85 × depth 0.9 m");
    expect(text(renderer.root)).toContain("Mounting: floor");
  });
});
