import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), share: vi.fn(), remove: vi.fn(), alert: vi.fn() }));
vi.mock("react-native", () => ({ Alert: { alert: mocks.alert }, Share: { share: mocks.share }, Pressable: "Pressable", SafeAreaView: "SafeAreaView", ScrollView: "ScrollView", Text: "Text", View: "View", Keyboard: { dismiss: vi.fn() }, StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} } }));
vi.mock("expo-file-system/legacy", () => ({ deleteAsync: mocks.remove }));
vi.mock("../../storage/projectRepository", () => ({ loadProjectDocuments: mocks.load, saveProjectDocuments: mocks.save }));
vi.mock("../workspace/PlacementControls", () => ({ PlacementControls: "PlacementControls" }));
vi.mock("./NativeSavedRoom3DView", () => ({ NativeSavedRoom3DView: "NativeSavedRoom3DView", savedRoom3DViewAvailable: true }));
import { SavedRoomViewerScreen } from "./SavedRoomViewerScreen";
import { createEmptyProjectDocument } from "../../storage/projectDocument";
import rooms from "../../domain/fixtures/threeRoomAssembly.json";
import type { RoomCapture } from "../../domain/projects";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === "string" ? child : text(child)).join("");
const button = (label: string) => renderer.root.findAll(node => node.type === "Pressable" as any).find(node => text(node) === label)!;
const native = () => renderer.root.findByType("NativeSavedRoom3DView" as any);
beforeEach(() => {
  vi.clearAllMocks();
  const document = createEmptyProjectDocument({ id: "project", name: "Kitchen design", roomCaptures: structuredClone(rooms) as RoomCapture[] });
  mocks.load.mockResolvedValue([document]);
  mocks.save.mockResolvedValue(undefined);
  mocks.share.mockResolvedValue({ action: "sharedAction" });
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
const open = async () => { await act(async () => { renderer = create(<SavedRoomViewerScreen projectId="project" mode="project" onClose={() => {}} />); }); };

describe("visual layout sharing", () => {
  it("saves the layout, requests a captioned native snapshot, then shares and cleans the temporary image", async () => {
    await open();
    await act(async () => button("Share layout image").props.onPress());
    expect(mocks.save).toHaveBeenCalled();
    const request = JSON.parse(native().props.snapshotRequestJSON);
    expect(request).toMatchObject({ title: "Kitchen design · Project layout", note: expect.stringContaining("Planning visualization") });
    expect(button("Preparing image…").props.disabled).toBe(true);
    await act(async () => native().props.onSnapshotResult({ nativeEvent: { requestId: request.requestId, uri: "file:///cache/layout.png" } }));
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({ url: "file:///cache/layout.png", title: "Kitchen design layout" }));
    expect(mocks.remove).toHaveBeenCalledWith("file:///cache/layout.png", { idempotent: true });
    expect(button("Share layout image").props.disabled).toBe(false);
  });

  it("does not export when the layout cannot be saved", async () => {
    await open();
    mocks.save.mockRejectedValueOnce(new Error("Disk full"));
    await act(async () => button("Share layout image").props.onPress());
    expect(native().props.snapshotRequestJSON).toBe("");
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith("Layout not shared", expect.stringContaining("Save failed"));
  });

  it("surfaces native export errors and ignores unrelated completion events", async () => {
    await open();
    await act(async () => button("Share layout image").props.onPress());
    const request = JSON.parse(native().props.snapshotRequestJSON);
    await act(async () => native().props.onSnapshotResult({ nativeEvent: { requestId: request.requestId + 1, uri: "file:///unrelated.png" } }));
    expect(mocks.share).not.toHaveBeenCalled();
    await act(async () => native().props.onSnapshotResult({ nativeEvent: { requestId: request.requestId, error: "Model is not ready." } }));
    expect(mocks.alert).toHaveBeenCalledWith("Layout image not shared", "Model is not ready.");
    expect(button("Share layout image").props.disabled).toBe(false);
  });
});

describe("saved model loading", () => {
  it("reports a missing project instead of loading indefinitely and can recover on retry", async () => {
    mocks.load.mockResolvedValueOnce([]);
    await open();
    expect(renderer.root.findAllByType("NativeSavedRoom3DView" as any)).toHaveLength(0);
    expect(button("Retry loading model")).toBeDefined();
    await act(async () => button("Retry loading model").props.onPress());
    expect(renderer.root.findAllByType("NativeSavedRoom3DView" as any)).toHaveLength(1);
  });
});

describe("proposed object editing", () => {
  it("moves and rotates a catalog object through the existing controls, saves it, and keeps geometry off the update bridge", async () => {
    const documents = await mocks.load();
    const transform = { position: { x: 1, y: 0.5, z: 2 }, rotation: { pitch: 0, yaw: 0, roll: 0 }, scale: { x: 1, y: 1, z: 1 } };
    documents[0].project.placedObjects.push({ id: "proposal", catalogObjectId: "furniture-sofa", roomCaptureId: rooms[0].id, anchorId: "source-anchor", displayName: "Sofa", transform, roomLocalTransform: transform, dimensions: { width: 2, height: 1, depth: 1, unit: "m" }, status: "active", placedAt: "2026-10-01", updatedAt: "2026-10-01" });
    await open();
    const geometry = native().props.modelJSON;
    await act(async () => native().props.onSceneSelection({ nativeEvent: { kind: "feature", roomId: rooms[0].id, featureId: "placed:proposal" } }));
    const controls = () => renderer.root.findByType("PlacementControls" as any);
    expect(controls().props.enabled).toBe(true);
    await act(async () => controls().props.onMove(1, 0));
    await act(async () => controls().props.onRotate(1));
    const bridge = JSON.parse(native().props.objectTransformsJSON);
    expect(bridge[rooms[0].id]["placed:proposal"].position).toEqual({ x: 1.1, y: 0.5, z: 2 });
    expect(native().props.modelJSON).toBe(geometry);
    await act(async () => controls().props.onPlace());
    const saved = mocks.save.mock.calls.at(-1)![0][0].project;
    expect(saved.placedObjects[0].roomLocalTransform.position.x).toBeCloseTo(1.1);
    expect(saved.placedObjects[0].roomLocalTransform.rotation.yaw).toBeCloseTo(5 * Math.PI / 180);
    expect(saved.roomCaptures).toEqual(documents[0].project.roomCaptures);
  });
});
