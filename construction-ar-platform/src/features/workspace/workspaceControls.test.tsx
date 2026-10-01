import { afterEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ dismiss: vi.fn(), handlers: {} as Record<string, Function>, state: vi.fn(), effects: [] as (() => unknown)[] }));
vi.mock("react-native", () => ({ Keyboard: { dismiss: native.dismiss }, AppState: { addEventListener: () => ({ remove() {} }) }, Pressable: "Pressable", View: "View", Text: "Text", StyleSheet: { create: (value: unknown) => value }, PanResponder: { create: (handlers: Record<string, Function>) => { native.handlers = handlers; return { panHandlers: handlers }; } } }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(), useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, native.state], useEffect: (effect: () => unknown) => { native.effects.push(effect); } }));
import { ControlDrawer } from "./ControlDrawer";
import { PlacementControls } from "./PlacementControls";
function nodes(element: any): any[] { return !element || typeof element !== "object" ? [] : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]; }
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); native.effects = []; });
describe("workspace drawers", () => {
  for (const label of ["Scan controls", "Model controls"]) it(`${label} opens/closes while keeping existing children mounted`, () => {
    let expanded = false;
    const children = <div>Measurements · Stream · Stop · Save · Reset</div>;
    const render = () => ControlDrawer({ label, expanded, onChange: value => { expanded = value; }, children });
    let tree = render();
    expect(nodes(tree).find(n => n.props.accessibilityElementsHidden === true)).toBeDefined();
    expect(nodes(tree)).toContain(children);
    nodes(tree).find(n => n.props.accessibilityLabel === label).props.onPress();
    expect(expanded).toBe(true);
    tree = render();
    expect(nodes(tree).find(n => n.props.accessibilityLabel === label).props.accessibilityState.expanded).toBe(true);
    nodes(tree).find(n => n.props.accessibilityLabel === label).props.onPress();
    expect(expanded).toBe(false);
    expect(native.dismiss).toHaveBeenCalledTimes(2);
  });
});
describe("placement control input", () => {
  it("keeps neutral and disabled input inert; moves only during joystick input; centers on release", () => {
    vi.useFakeTimers(); const onMove = vi.fn();
    PlacementControls({ enabled: true, targetKey: "chair", precision: false, onPrecision() {}, onMove, onRotate() {}, onPlace() {} });
    native.handlers.onPanResponderGrant(); vi.advanceTimersByTime(200); expect(onMove).not.toHaveBeenCalled();
    native.handlers.onPanResponderMove({}, { dx: 36, dy: 0 }); vi.advanceTimersByTime(100);
    expect(onMove).toHaveBeenCalledWith(1, 0);
    native.handlers.onPanResponderRelease(); onMove.mockClear(); vi.advanceTimersByTime(500);
    expect(onMove).not.toHaveBeenCalled(); expect(native.state).toHaveBeenLastCalledWith({ x: 0, y: 0 });
    PlacementControls({ enabled: false, targetKey: "locked", precision: false, onPrecision() {}, onMove, onRotate() {}, onPlace() {} });
    expect(native.handlers.onStartShouldSetPanResponder()).toBe(false);
  });
  it("routes rotation directions and Place, stopping movement on confirmation", () => {
    vi.useFakeTimers(); const onRotate = vi.fn(), onPlace = vi.fn(), onMove = vi.fn();
    const tree = PlacementControls({ enabled: true, targetKey: "room", precision: true, onPrecision() {}, onMove, onRotate, onPlace });
    const actions = nodes(tree).filter(n => typeof n.type === "function");
    actions.find(n => n.props.hint === "Rotate left").props.onPress();
    actions.find(n => n.props.hint === "Rotate right").props.onPress();
    expect(onRotate.mock.calls).toEqual([[-1], [1]]);
    native.handlers.onPanResponderGrant(); native.handlers.onPanResponderMove({}, { dx: 36, dy: 0 });
    actions.find(n => n.props.label === "Place ✓").props.onPress(); vi.advanceTimersByTime(200);
    expect(onPlace).toHaveBeenCalledOnce(); expect(onMove).not.toHaveBeenCalled();
  });
});
