import { RoomPlacementAlignment } from "../features/measurement/RoomPlacementAlignment";
import { canonicalTransform } from "../domain/spatialTransforms";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), alert: vi.fn(), preview: vi.fn(), duplicate: vi.fn() }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Image: "Image", KeyboardAvoidingView: "KeyboardAvoidingView", SafeAreaView: "SafeAreaView", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View", Pressable: "Pressable",
  NativeModules: { ProjectDocumentPreview: { openDocument: mocks.preview } },
  Platform: { OS: "ios" }, StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Alert: { alert: mocks.alert }, Share: { share: vi.fn() }, Keyboard: { dismiss: vi.fn() }, LogBox: { ignoreLogs: vi.fn(), ignoreAllLogs: vi.fn() },
}));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("../storage/projectRepository", () => ({ loadProjectDocuments: mocks.load, duplicateProjectDocument: mocks.duplicate, saveProjectDocuments: mocks.save, loadProjectScan: vi.fn(), persistProjectMedia: vi.fn(), replaceProjectDocument: (documents: any[], document: any) => documents.map(item => item.project.id === document.project.id ? document : item) }));
vi.mock("../features/camera/LiveCameraScreen", () => ({ LiveCameraScreen: "LiveCameraScreen" }));
vi.mock("../features/camera/LiveWebRtcPublisherScreen", () => ({ LiveWebRtcPublisherScreen: "LiveWebRtcPublisherScreen" }));
vi.mock("../features/camera/LiveStreamPanel", () => ({ LiveStreamPanel: "LiveStreamPanel" }));
vi.mock("../features/roomViewer/SavedRoomViewerScreen", () => ({ SavedRoomViewerScreen: "SavedRoomViewerScreen" }));
vi.mock("../features/measurement/NativeMeasurementARView", () => ({ NativeMeasurementARView: "NativeMeasurementARView", measurementARViewAvailable: true }));
vi.mock("../features/roomScan/NativeRoomScanView", () => ({ NativeRoomScanView: "NativeRoomScanView", roomScanAvailable: true }));
import { AppShell } from "./AppShell";
import { HomeScreen } from "../features/home/HomeScreen";
import { MeasurementScreen } from "../features/measurement/MeasurementScreen";
import { RoomScanScreen } from "../features/roomScan/RoomScanScreen";
import { createEmptyProjectDocument } from "../storage/projectDocument";
import rooms from "../domain/fixtures/threeRoomAssembly.json";
import type { RoomCapture } from "../domain/projects";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
let documents: ReturnType<typeof createEmptyProjectDocument>[];
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === "string" ? child : text(child)).join("");
function button(label: string) {
  return renderer.root.findAll(node => node.type === "Pressable" as any).find(node => text(node) === label)!;
}
async function press(label: string) { await act(async () => button(label).props.onPress()); }
beforeEach(() => {
  vi.clearAllMocks();
  documents = ["A", "B"].map(id => createEmptyProjectDocument({ id, name: `Project ${id}`, roomCaptures: structuredClone(rooms) as RoomCapture[] }));
  mocks.load.mockImplementation(async () => documents);
  mocks.save.mockImplementation(async value => { documents = value; });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });

describe("project navigation", () => {
  it("opens AR tools in project B and returns to B after closing", async () => {
    await act(async () => { renderer = create(<AppShell />); });
    const home = renderer.root.findByType(HomeScreen);
    await act(async () => {
      home.props.onProjectChange("B");
      home.props.onOpenMeasure("B", "electrical-outlet-duplex");
    });
    const measure = renderer.root.findByType(MeasurementScreen);
    expect(measure.props.initialProjectId).toBe("B");
    expect(measure.props.initialCatalogObjectId).toBe("electrical-outlet-duplex");
    await act(async () => measure.props.onClose());
    expect(renderer.root.findByType(HomeScreen).props.initialProjectId).toBe("B");
    expect(renderer.root.findAll(node => node.props.project?.id === "B").length).toBeGreaterThan(0);
  });

  it("keeps project changes made inside AR tools when returning to the dashboard", async () => {
    await act(async () => { renderer = create(<AppShell />); });
    await act(async () => renderer.root.findByType(HomeScreen).props.onOpenMeasure("B"));
    await act(async () => {
      renderer.root.findByType(MeasurementScreen).props.onProjectChange("A");
      renderer.root.findByType(MeasurementScreen).props.onClose();
    });
    expect(renderer.root.findByType(HomeScreen).props.initialProjectId).toBe("A");
  });

  it("passes the selected dashboard project to ordinary and catalog AR actions", async () => {
    const open = vi.fn();
    await act(async () => { renderer = create(<HomeScreen initialProjectId="B" onProjectChange={() => {}} onOpenMeasure={open} onOpenCamera={() => {}} onOpenStream={() => {}} onOpenRoomScan={() => {}} onOpenRoomViewer={() => {}} />); });
    await press("Open AR tools");
    expect(open).toHaveBeenLastCalledWith("B", undefined);
    const dashboard = renderer.root.find(node => node.props.project?.id === "B");
    await act(async () => dashboard.props.onSelectCatalogObject("electrical-outlet-duplex"));
    const placementButton = renderer.root.findAll(node => node.type === "Pressable" as any).find(node => text(node).startsWith("Open AR placement for"))!;
    await act(async () => placementButton.props.onPress());
    expect(open).toHaveBeenLastCalledWith("B", "electrical-outlet-duplex");
  });
});

describe("scan capture recovery", () => {
  const completed = { nativeEvent: { kind: "scan-completed", message: "Complete", scan: { ...(rooms[0] as any).roomScan, nativeIdentifier: "new-scan", measurements: [] } } };
  it("retains a failed capture, guards closing, and retries without duplicating rooms", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Disk full"));
    const close = vi.fn();
    await act(async () => { renderer = create(<RoomScanScreen projectId="B" onClose={close} />); });
    const native = renderer.root.findByType("NativeRoomScanView" as any);
    await act(async () => native.props.onRoomScanUpdate(completed));
    expect(button("Retry saving scan")).toBeDefined();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: "Close Room Scan" }).props.onPress());
    expect(close).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith("Scan has not been saved", expect.any(String), expect.any(Array));
    await press("Retry saving scan");
    expect(documents[1].project.roomCaptures).toHaveLength(4);
    expect(documents[0].project.roomCaptures).toHaveLength(3);
    await act(async () => native.props.onRoomScanUpdate(completed));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    await press("Back to project");
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not start capture after a load failure and can retry loading", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Read failed"));
    await act(async () => { renderer = create(<RoomScanScreen projectId="B" onClose={() => {}} />); });
    expect(renderer.root.findAllByType("NativeRoomScanView" as any)).toHaveLength(0);
    await press("Retry loading project");
    expect(renderer.root.findAllByType("NativeRoomScanView" as any)).toHaveLength(1);
  });
});


describe("offline plan references", () => {
  it("opens a saved PDF from project B without changing project selection", async () => {
    const blueprint = { id: "plan", name: "Kitchen plan.pdf", uri: "file:///documents/plan.pdf", mimeType: "application/pdf", importedAt: "2026-10-01" };
    documents[1].project.blueprints.push(blueprint);
    mocks.preview.mockResolvedValue(undefined);
    await act(async () => { renderer = create(<HomeScreen initialProjectId="B" onProjectChange={() => {}} onOpenMeasure={() => {}} onOpenCamera={() => {}} onOpenStream={() => {}} onOpenRoomScan={() => {}} onOpenRoomViewer={() => {}} />); });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: "Open plan Kitchen plan.pdf" }).props.onPress());
    expect(mocks.preview).toHaveBeenCalledWith(blueprint.uri, blueprint.name);
    expect(renderer.root.findAll(node => node.props.project?.id === "B").length).toBeGreaterThan(0);
  });

  it("shows an actionable error when the durable plan file is unavailable", async () => {
    documents[1].project.blueprints.push({ id: "plan", name: "Missing.pdf", uri: "file:///missing.pdf", mimeType: "application/pdf", importedAt: "2026-10-01" });
    mocks.preview.mockRejectedValueOnce(new Error("Import this file again."));
    await act(async () => { renderer = create(<HomeScreen initialProjectId="B" onProjectChange={() => {}} onOpenMeasure={() => {}} onOpenCamera={() => {}} onOpenStream={() => {}} onOpenRoomScan={() => {}} onOpenRoomViewer={() => {}} />); });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: "Open plan Missing.pdf" }).props.onPress());
    expect(mocks.alert).toHaveBeenCalledWith("Plan could not be opened", "Import this file again.");
  });
});

describe("AR edit recovery", () => {
  const placement = (id: string, x: number) => ({ nativeEvent: { arSessionId: "session", placement: { kind: "object-placed", message: "Placed", object: { id, catalogObjectId: "furniture-sofa", displayName: id, placementMode: "floor-mounted", dimensions: { width: 2, height: 1, depth: 0.9 }, position: { x, y: 0, z: 0 }, rotationY: 0 } } } });
  it("retries a failed placement before subsequent edits and saves to the selected project", async () => {
    await act(async () => { renderer = create(<MeasurementScreen initialProjectId="B" onProjectChange={() => {}} onClose={() => {}} />); });
    mocks.save.mockRejectedValueOnce(new Error("Disk full"));
    await act(async () => renderer.root.findByType("NativeMeasurementARView" as any).props.onMeasurementUpdate(placement("first", 1)));
    expect(documents[1].project.placedObjects).toHaveLength(0);
    expect(button("Retry saving changes")).toBeDefined();
    // A later native event must not discard the earlier failed edit.
    await act(async () => renderer.root.findByType("NativeMeasurementARView" as any).props.onMeasurementUpdate(placement("second", 2)));
    expect(documents[1].project.placedObjects.map(object => object.id)).toEqual(["first", "second"]);
    expect(documents[0].project.placedObjects).toHaveLength(0);
    expect(button("Retry saving changes")).toBeUndefined();
  });

  it("keeps the workspace open on persistent failure and closes only after pending edits save", async () => {
    const close = vi.fn();
    await act(async () => { renderer = create(<MeasurementScreen initialProjectId="B" onProjectChange={() => {}} onClose={close} />); });
    mocks.save.mockRejectedValueOnce(new Error("Disk full")).mockRejectedValueOnce(new Error("Still full"));
    await act(async () => renderer.root.findByType("NativeMeasurementARView" as any).props.onMeasurementUpdate(placement("retained", 1)));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: "Open measurement menu" }).props.onPress());
    await press("Close Workspace");
    expect(close).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith("Changes not saved", expect.any(String));
    await press("Retry saving changes");
    expect(documents[1].project.placedObjects.map(object => object.id)).toEqual(["retained"]);
    await act(async () => renderer.root.findByProps({ accessibilityLabel: "Open measurement menu" }).props.onPress());
    await press("Close Workspace");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("AR workspace loading", () => {
  it("offers retry after storage failure and starts AR only once projects load", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Storage unavailable"));
    await act(async () => { renderer = create(<MeasurementScreen initialProjectId="B" onProjectChange={() => {}} onClose={() => {}} />); });
    expect(renderer.root.findAllByType("NativeMeasurementARView" as any)).toHaveLength(0);
    await press("Retry loading projects");
    expect(renderer.root.findAllByType("NativeMeasurementARView" as any)).toHaveLength(1);
  });
});

describe("design alternative workflow", () => {
  async function openHome() {
    const change = vi.fn();
    await act(async () => { renderer = create(<HomeScreen initialProjectId="B" onProjectChange={change} onOpenMeasure={() => {}} onOpenCamera={() => {}} onOpenStream={() => {}} onOpenRoomScan={() => {}} onOpenRoomViewer={() => {}} />); });
    await press("Duplicate as design alternative");
    return change;
  }
  it("duplicates the selected project and switches to the saved alternative", async () => {
    const change = await openHome();
    const alternative = createEmptyProjectDocument({ id: "copy", name: "Project B - alternative" });
    mocks.duplicate.mockResolvedValueOnce({ documents: [alternative, ...documents], projectId: "copy" });
    await press("Create alternative");
    expect(mocks.duplicate).toHaveBeenCalledWith("B", "Project B - alternative");
    expect(change).toHaveBeenLastCalledWith("copy");
    expect(renderer.root.findAll(node => node.props.project?.id === "copy")).not.toHaveLength(0);
    expect(text(renderer.root)).toContain("You are now editing this independent alternative");
  });
  it("retains the chosen name and source after failure for retry", async () => {
    const change = await openHome();
    const input = renderer.root.findByProps({ placeholder: "Alternative name" });
    await act(async () => input.props.onChangeText("Kitchen option two"));
    mocks.duplicate.mockRejectedValueOnce(new Error("Scan archive unavailable"));
    await press("Create alternative");
    expect(change).toHaveBeenLastCalledWith("B");
    expect(renderer.root.findByProps({ placeholder: "Alternative name" }).props.value).toBe("Kitchen option two");
    expect(mocks.alert).toHaveBeenCalledWith("Project storage unavailable", "Scan archive unavailable");
    expect(button("Create alternative")).toBeDefined();
  });
  it("shows copying progress and prevents a second submission or navigation while saving", async () => {
    await openHome();
    let finish!: (value: any) => void;
    mocks.duplicate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { button("Create alternative").props.onPress(); });
    expect(text(renderer.root)).toContain("Copying the complete design");
    expect(renderer.root.findAllByType("Pressable" as any)).toHaveLength(0);
    await act(async () => finish({ documents, projectId: "B" }));
    expect(mocks.duplicate).toHaveBeenCalledOnce();
  });
});

describe("observed mounting surface workflow", () => {
  it("saves compatible support evidence with placement, retries failures, and sends it back to AR", async () => {
    await act(async () => { renderer = create(<MeasurementScreen initialProjectId="B" onProjectChange={() => {}} onClose={() => {}} />); });
    const update = async (nativeEvent: any) => act(async () => renderer.root.findByType("NativeMeasurementARView" as any).props.onMeasurementUpdate({ nativeEvent }));
    await update({ arSessionId: "surface-session", tracking: { quality: "normal" } });
    await act(async () => renderer.root.findByType(RoomPlacementAlignment).props.onAligned(canonicalTransform()));
    const surface = { id: "wall-plane", kind: "wall", transformMatrix: canonicalTransform({ position: { x: 0, y: 1, z: 0 } }).matrix!, observedAt: "2026-10-01T22:00:00Z" };
    const object = { id: "mounted-outlet", catalogObjectId: "electrical-outlet-duplex", displayName: "Outlet", placementMode: "wall-mounted", dimensions: { width: 0.08, height: 0.12, depth: 0.04 }, position: { x: 0, y: 1, z: 0.02 }, rotationY: 0, surfaceRotation: 0.3, surface };
    mocks.save.mockRejectedValueOnce(new Error("Disk full"));
    await update({ arSessionId: "surface-session", placement: { kind: "object-placed", message: "Mounted", object } });
    await press("Retry saving changes");
    const saved = documents[1].project;
    expect(saved.anchors[0].observation?.nativePlaneId).toBe("wall-plane");
    expect(saved.placedObjects[0].surfaceRotation).toBe(0.3);
    expect(saved.validationIssues.some(issue => issue.ruleId === "attach-to-supported-surface")).toBe(false);
    const restored = renderer.root.findByType("NativeMeasurementARView" as any).props.placedObjects[0];
    expect(restored.surface).toEqual(surface);
    expect(restored.allowedSurfaceKinds).toEqual(["wall"]);
    expect(restored.surfaceRotation).toBe(0.3);
    expect(documents[0].project.anchors).toHaveLength(0);
  });
});

describe("project documentation persistence", () => {
  it("keeps the camera open until photo persistence finishes", async () => {
    await act(async () => { renderer = create(<AppShell />); });
    let finish!: () => void;
    const handler = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => renderer.root.findByType(HomeScreen).props.onOpenCamera(handler, () => {}));
    let pending: Promise<void>;
    await act(async () => { pending = renderer.root.findByType("LiveCameraScreen" as any).props.onPhotoCaptured("file:///tmp/photo.jpg"); });
    expect(renderer.root.findAllByType(HomeScreen)).toHaveLength(0);
    expect(handler).toHaveBeenCalledWith("file:///tmp/photo.jpg");
    await act(async () => { finish(); await pending; });
    expect(renderer.root.findAllByType(HomeScreen)).toHaveLength(1);
  });
  it("saves notes to the latest selected project without losing concurrent metadata", async () => {
    await act(async () => { renderer = create(<HomeScreen initialProjectId="B" onProjectChange={() => {}} onOpenMeasure={() => {}} onOpenCamera={() => {}} onOpenStream={() => {}} onOpenRoomScan={() => {}} onOpenRoomViewer={() => {}} />); });
    documents[1] = { ...documents[1], project: { ...documents[1].project, siteName: "Latest saved site" } };
    await act(async () => renderer.root.findByProps({ accessibilityLabel: "Field note" }).props.onChangeText("Review kitchen wiring"));
    await press("Save note");
    expect(documents[1].project.fieldNotes[0].text).toBe("Review kitchen wiring");
    expect(documents[1].project.siteName).toBe("Latest saved site");
    expect(documents[0].project.fieldNotes).toHaveLength(0);
  });
});
