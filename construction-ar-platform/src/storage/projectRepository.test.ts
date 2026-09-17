import { assemblyMatrix, canonicalTransform } from "../domain/spatialTransforms";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  asyncStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
  getInfoAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  copyAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({ default: mocks.asyncStorage }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  EncodingType: { UTF8: "utf8" },
  copyAsync: mocks.copyAsync,
  deleteAsync: vi.fn(),
  getInfoAsync: mocks.getInfoAsync,
  makeDirectoryAsync: mocks.makeDirectoryAsync,
  readDirectoryAsync: vi.fn(),
  readAsStringAsync: mocks.readAsStringAsync,
  writeAsStringAsync: mocks.writeAsStringAsync,
}));

import roomsJSON from "../domain/fixtures/threeRoomAssembly.json";
import { identityTransform, type RoomCapture } from "../domain/projects";
import { initialAssemblyTransforms, moveAssemblyRoom, rotateAssemblyRoom, saveAssemblyToProject } from "../domain/roomAssembly";
import { createEmptyProjectDocument } from "./projectDocument";
import { loadProjectDocuments, persistProjectMedia, saveProjectDocuments } from "./projectRepository";

describe("projectRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInfoAsync.mockResolvedValue({ exists: false });
    mocks.makeDirectoryAsync.mockResolvedValue(undefined);
    mocks.copyAsync.mockResolvedValue(undefined);
  });

  it("copies project media into a stable per-project Documents path", async () => {
    const uri = await persistProjectMedia(
      "project/1",
      "photo 1",
      "file:///tmp/site-photo.jpg",
    );

    expect(uri).toBe("file:///documents/construction-ar-platform/media/project%2F1/photo%201.jpg");
    expect(mocks.makeDirectoryAsync).toHaveBeenCalledWith(
      "file:///documents/construction-ar-platform/media/project%2F1/",
      { intermediates: true },
    );
    expect(mocks.copyAsync).toHaveBeenCalledWith({
      from: "file:///tmp/site-photo.jpg",
      to: uri,
    });
  });

  it("does not recopy media already managed by the project repository", async () => {
    const uri = "file:///documents/construction-ar-platform/media/project-1/photo-1.jpg";

    await expect(persistProjectMedia("project-1", "photo-1", uri)).resolves.toBe(uri);
    expect(mocks.copyAsync).not.toHaveBeenCalled();
  });

  it("surfaces device storage read failures instead of treating them as no projects", async () => {
    mocks.asyncStorage.getItem.mockRejectedValueOnce(new Error("storage offline"));

    await expect(loadProjectDocuments()).rejects.toThrow(
      "Could not read saved projects from device storage.",
    );
  });

  it("migrates legacy temporary media when a project is saved", async () => {
    const document = createEmptyProjectDocument({ id: "project-1", name: "Kitchen" });
    document.project.photos = [{
      id: "photo-1",
      uri: "file:///tmp/legacy-photo.jpg",
      capturedAt: "2026-09-07T12:00:00.000Z",
    }];

    await saveProjectDocuments([document]);

    const saved = JSON.parse(mocks.asyncStorage.setItem.mock.calls[0][1] as string) as typeof document[];
    expect(saved[0].project.photos[0].uri).toBe(
      "file:///documents/construction-ar-platform/media/project-1/photo-1.jpg",
    );
    expect(mocks.copyAsync).toHaveBeenCalledWith({
      from: "file:///tmp/legacy-photo.jpg",
      to: "file:///documents/construction-ar-platform/media/project-1/photo-1.jpg",
    });
  });
  it("persists three-room placement and lock through repository save/load without changing measurements", async () => {
    let stored: string | null = null;
    mocks.asyncStorage.setItem.mockImplementation(async (_key: string, value: string) => { stored = value; });
    mocks.asyncStorage.getItem.mockImplementation(async () => stored);
    const doc = createEmptyProjectDocument({ id: "assembly", name: "Three rooms", roomCaptures: structuredClone(roomsJSON) as RoomCapture[] });
    const transforms = initialAssemblyTransforms(doc.project);
    transforms["room-2"] = moveAssemblyRoom(transforms["room-2"], "z", 8);
    doc.project = saveAssemblyToProject(doc.project, transforms, "room-1");
    await saveProjectDocuments([doc]);
    const reopened = (await loadProjectDocuments({ includeScans: false }))[0];
    expect(reopened.project.spatialModel?.lockedRoomId).toBe("room-1");
    expect(Object.values(reopened.project.spatialModel!.roomTransforms).map(assemblyMatrix)).toEqual(Object.values(transforms).map(assemblyMatrix));
    expect(reopened.project.roomCaptures.map(r => r.roomScan?.measurements)).toEqual(doc.project.roomCaptures.map(r => r.roomScan?.measurements));
    reopened.project = saveAssemblyToProject(reopened.project, initialAssemblyTransforms(reopened.project, true));
    await saveProjectDocuments([reopened]);
    const reset = (await loadProjectDocuments({ includeScans: false }))[0].project;
    expect(reset.roomCaptures).toHaveLength(3);
    expect(reset.spatialModel?.lockedRoomId).toBeUndefined();
    expect(reset.roomCaptures.map(r => r.roomScan?.elements)).toEqual(doc.project.roomCaptures.map(r => r.roomScan?.elements));
  });

  it("writes grouped metadata to both archive and index and reopens every spatial instance", async () => {
    let stored: string | null = null;
    const archives = new Map<string, string>();
    mocks.asyncStorage.setItem.mockImplementation(async (_key: string, value: string) => { stored = value; });
    mocks.asyncStorage.getItem.mockImplementation(async () => stored);
    mocks.writeAsStringAsync.mockImplementation(async (uri: string, value: string) => { archives.set(uri, value); });
    mocks.readAsStringAsync.mockImplementation(async (uri: string) => archives.get(uri));
    mocks.getInfoAsync.mockImplementation(async (uri: string) => ({ exists: archives.has(uri) }));
    const doc = createEmptyProjectDocument({ id: "objects", name: "Dining" });
    // Add a fresh native-format scan after document creation, exercising save normalization.
    doc.project.roomCaptures = [{
      id: "room", name: "Dining", source: "roomplan", status: "completed", unit: "m", surfaces: [],
      roomScan: { version: 1, source: "roomplan", capturedAt: "2026-09-14", nativeCapturedRoomJSON: "native-captured-room", portal: { format: "construction-ar-room-scan", version: 1 }, elements: [0, 1, 2, 3].map(i => ({
        id: `chair-${i}`, kind: "furniture", category: "chair", representation: "chair", confidence: 0.95,
        dimensions: { width: 0.5, depth: 0.5, height: 1, unit: "m" },
        transform: { ...identityTransform(), position: { x: i, y: 0.5, z: 0 - i }, rotation: { pitch: 0, yaw: i, roll: 0 } },
      })) },
    }];
    await saveProjectDocuments([doc]);
    const index = (await loadProjectDocuments())[0];
    const full = (await loadProjectDocuments({ includeScans: true, projectId: "objects" }))[0];
    const scan = full.project.roomCaptures[0].roomScan!;
    expect(index.schemaVersion).toBe(8);
    expect(index.project.roomCaptures[0].roomScan!.nativeCapturedRoomJSON).toBeUndefined();
    expect(scan.nativeCapturedRoomJSON).toBe("native-captured-room");
    expect(scan.objectTypes).toEqual(index.project.roomCaptures[0].roomScan!.objectTypes);
    expect(scan.objectTypes![0]).toMatchObject({ quantity: 4, dimensions: { width: 0.5, depth: 0.5, height: 1, unit: "m" }, footprintArea: 0.25, faceArea: 0.5, boundingVolume: 0.25 });
    expect(scan.elements.map(e => e.transform)).toEqual(doc.project.roomCaptures[0].roomScan!.elements.map(e => e.transform));
    expect(scan.elements.every(e => e.roomCaptureId === "room" && e.objectTypeId === scan.objectTypes![0].id)).toBe(true);
    expect(JSON.parse(archives.get(scan.archiveUri!)!).objectTypes).toEqual(scan.objectTypes);
    // Metadata-only edits must not overwrite the heavy scan archive with a summary.
    const archiveBefore = archives.get(scan.archiveUri!);
    index.project.fieldNotes.push({ id: "note", text: "Four chairs", createdAt: "2026-09-14" });
    await saveProjectDocuments([index]);
    expect(archives.get(scan.archiveUri!)).toBe(archiveBefore);
    // An older full archive must be normalized even if the index already has metadata.
    const legacy = JSON.parse(archiveBefore!);
    delete legacy.objectTypes; delete legacy.objectMetadataVersion;
    legacy.elements.forEach((e: Record<string, unknown>) => { delete e.objectTypeId; delete e.roomCaptureId; });
    archives.set(scan.archiveUri!, JSON.stringify(legacy));
    const migrated = (await loadProjectDocuments({ includeScans: true }))[0].project.roomCaptures[0].roomScan!;
    expect(migrated.objectTypes).toEqual(scan.objectTypes);
    expect(migrated.elements).toEqual(scan.elements);
  });

  it("persists hierarchy through metadata-only assembly saves and merges child overrides into heavy archives", async () => {
    let stored: string | null = null;
    const archives = new Map<string, string>();
    mocks.asyncStorage.setItem.mockImplementation(async (_key: string, value: string) => { stored = value; });
    mocks.asyncStorage.getItem.mockImplementation(async () => stored);
    mocks.writeAsStringAsync.mockImplementation(async (uri: string, value: string) => { archives.set(uri, value); });
    mocks.readAsStringAsync.mockImplementation(async (uri: string) => archives.get(uri));
    mocks.getInfoAsync.mockImplementation(async (uri: string) => ({ exists: archives.has(uri) }));
    const rooms = structuredClone(roomsJSON) as RoomCapture[];
    rooms.forEach(room => { room.roomScan!.nativeCapturedRoomJSON = `archive-${room.id}`; });
    let doc = createEmptyProjectDocument({ id: "hierarchy", name: "Building", roomCaptures: rooms,
      placedObjects: [0, 1].map(i => ({ id: `p-${i}`, roomCaptureId: `room-${i + 1}`, catalogObjectId: "furniture-armchair", anchorId: `a-${i}`, displayName: "Chair", dimensions: { width: 0.5, depth: 0.5, height: 1, unit: "m" }, transform: identityTransform(), roomLocalTransform: canonicalTransform({ position: { x: i + 1, y: 0.5, z: 3 } }), transformSpace: "room-local", status: "active", placedAt: "2026-09-14", updatedAt: "2026-09-14" })),
    });
    await saveProjectDocuments([doc]);
    const archiveBytes = [...archives.entries()];
    doc = (await loadProjectDocuments())[0];
    const originalPlaced = structuredClone(doc.project.placedObjects);
    // Future per-object edits live in the lightweight index, not the heavy capture payload.
    const object = doc.project.roomCaptures[1].roomScan!.elements.find(e => e.kind === "furniture")!;
    object.roomLocalTransform = canonicalTransform({ position: { x: 3, y: 0.5, z: 4 } });
    const expectedChild = object.roomLocalTransform.matrix;
    let transforms = initialAssemblyTransforms(doc.project);
    for (let i = 0; i < 8; i++) {
      transforms["room-2"] = rotateAssemblyRoom(moveAssemblyRoom(transforms["room-2"], "x", 0.2), 0.1, { x: 0, y: 0, z: 0 });
      doc.project = saveAssemblyToProject(doc.project, transforms, "room-1");
      await saveProjectDocuments([doc]);
      doc = (await loadProjectDocuments())[0];
      expect(doc.project.placedObjects).toEqual(originalPlaced);
      expect(doc.project.spatialModel!.lockedRoomId).toBe("room-1");
      Object.values(doc.project.spatialModel!.roomTransforms).map(assemblyMatrix).forEach((matrix, index) => matrix.forEach((value, axis) => expect(value).toBeCloseTo(Object.values(transforms).map(assemblyMatrix)[index][axis], 10)));
    }
    expect([...archives.entries()]).toEqual(archiveBytes);
    const full = (await loadProjectDocuments({ includeScans: true }))[0];
    expect(full.project.roomCaptures[1].roomScan!.elements.find(e => e.id === object.id)!.roomLocalTransform!.matrix).toEqual(expectedChild);
    expect(full.project.roomCaptures[1].roomScan!.nativeCapturedRoomJSON).toBe("archive-room-2");
    expect(full.project.placedObjects).toEqual(originalPlaced);
    expect(full.project.roomCaptures[1].roomScan!.objectTypes).toEqual(doc.project.roomCaptures[1].roomScan!.objectTypes);
  });

});
