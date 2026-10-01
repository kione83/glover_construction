import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), alert: vi.fn(), preview: vi.fn() }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Image: "Image", KeyboardAvoidingView: "KeyboardAvoidingView", SafeAreaView: "SafeAreaView", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View", Pressable: "Pressable",
  NativeModules: { ProjectDocumentPreview: { openDocument: mocks.preview } },
  Platform: { OS: "ios" }, StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Alert: { alert: mocks.alert }, Share: { share: vi.fn() }, Keyboard: { dismiss: vi.fn() }, LogBox: { ignoreLogs: vi.fn(), ignoreAllLogs: vi.fn() },
}));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("../storage/projectRepository", () => ({ loadProjectDocuments: mocks.load, saveProjectDocuments: mocks.save, loadProjectScan: vi.fn(), persistProjectMedia: vi.fn(), replaceProjectDocument: (documents: any[], document: any) => documents.map(item => item.project.id === document.project.id ? document : item) }));
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
