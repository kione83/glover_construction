import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
const mocks = vi.hoisted(() => ({ capture: vi.fn(), alert: vi.fn() }));
vi.mock("react-native", () => ({ Image: "Image", Text: "Text", View: "View", Pressable: "Pressable", StyleSheet: { create: (value: any) => value, absoluteFill: {} }, Alert: { alert: mocks.alert } }));
vi.mock("expo-camera", async () => {
  const React = await import("react");
  return { useCameraPermissions: () => [{ granted: true }, vi.fn()], CameraView: React.forwardRef((props: any, ref) => {
    React.useImperativeHandle(ref, () => ({ takePictureAsync: mocks.capture }));
    return React.createElement("CameraView", props);
  }) };
});
import { LiveCameraScreen } from "./LiveCameraScreen";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === "string" ? child : text(child)).join("");
const control = (label: string) => renderer.root.findByProps({ accessibilityLabel: label });
beforeEach(() => { vi.clearAllMocks(); mocks.capture.mockResolvedValue({ uri: "file:///tmp/captured.jpg" }); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
describe("site photo save recovery", () => {
  it("retains the captured image across save failure and retries the same image", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValueOnce(undefined);
    const close = vi.fn();
    await act(async () => { renderer = create(<LiveCameraScreen onPhotoCaptured={save} onClose={close} onClearPlacements={() => {}} />); });
    await act(async () => control("Capture project photo").props.onPress());
    expect(text(renderer.root)).toContain("Retry saving photo");
    expect(renderer.root.findByProps({ accessibilityLabel: "Unsaved captured photo" }).props.source.uri).toBe("file:///tmp/captured.jpg");
    await act(async () => control("Close live camera view").props.onPress());
    expect(close).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith("Photo has not been saved", expect.any(String), expect.any(Array));
    await act(async () => control("Capture project photo").props.onPress());
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(save.mock.calls.map(call => call[0])).toEqual(["file:///tmp/captured.jpg", "file:///tmp/captured.jpg"]);
  });
  it("blocks capture and close while persistence is in progress", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => { renderer = create(<LiveCameraScreen onPhotoCaptured={save} onClose={() => {}} onClearPlacements={() => {}} />); });
    await act(async () => { control("Capture project photo").props.onPress(); });
    expect(control("Capture project photo").props.disabled).toBe(true);
    expect(control("Close live camera view").props.disabled).toBe(true);
    expect(text(renderer.root)).toContain("Saving…");
    await act(async () => finish());
  });
  it("shows a recoverable camera error when no photo is returned", async () => {
    mocks.capture.mockResolvedValueOnce(undefined);
    const save = vi.fn();
    await act(async () => { renderer = create(<LiveCameraScreen onPhotoCaptured={save} onClose={() => {}} onClearPlacements={() => {}} />); });
    await act(async () => control("Capture project photo").props.onPress());
    expect(text(renderer.root)).toContain("camera did not return a photo");
    expect(save).not.toHaveBeenCalled();
  });
});
