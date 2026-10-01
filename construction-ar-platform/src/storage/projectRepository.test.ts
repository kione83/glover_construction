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
  deleteAsync: vi.fn(),
  readDirectoryAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({ default: mocks.asyncStorage }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  EncodingType: { UTF8: "utf8" },
  copyAsync: mocks.copyAsync,
  deleteAsync: mocks.deleteAsync,
  getInfoAsync: mocks.getInfoAsync,
  makeDirectoryAsync: mocks.makeDirectoryAsync,
  readDirectoryAsync: mocks.readDirectoryAsync,
  readAsStringAsync: mocks.readAsStringAsync,
  writeAsStringAsync: mocks.writeAsStringAsync,
}));

import roomsJSON from "../domain/fixtures/threeRoomAssembly.json";
import { identityTransform, type RoomCapture } from "../domain/projects";
import { initialAssemblyTransforms, moveAssemblyRoom, rotateAssemblyRoom, saveAssemblyToProject } from "../domain/roomAssembly";
import { createEmptyProjectDocument } from "./projectDocument";
import { duplicateProjectDocument, loadProjectDocuments, persistProjectMedia, saveProjectDocuments } from "./projectRepository";

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


describe("saved viewer object overrides", () => {
  it("saves and reloads furniture poses through the project repository", async () => {
    vi.clearAllMocks();
    mocks.getInfoAsync.mockResolvedValue({ exists: false });
    const document = createEmptyProjectDocument({ id: "object-layout", name: "Object layout", roomCaptures: structuredClone(roomsJSON) as RoomCapture[] });
    const roomId = document.project.roomCaptures[0].id;
    const pose = moveAssemblyRoom(identityTransform(), "x", 0.35);
    document.project.spatialModel!.objectTransforms = { [roomId]: { chair: pose } };
    await saveProjectDocuments([document]);
    mocks.asyncStorage.getItem.mockResolvedValue(mocks.asyncStorage.setItem.mock.calls.at(-1)![1]);
    const [reopened] = await loadProjectDocuments();
    expect(reopened.project.spatialModel?.objectTransforms?.[roomId].chair).toEqual(pose);
  });
});

describe("post-save cleanup", () => {
  it("does not report a committed project write as failed when archive cleanup cannot open its directory", async () => {
    vi.clearAllMocks();
    const document = createEmptyProjectDocument({ id: "cleanup", name: "Committed project" });
    mocks.asyncStorage.setItem.mockResolvedValueOnce(undefined);
    mocks.getInfoAsync.mockRejectedValueOnce(new Error("Cleanup directory unavailable"));
    await expect(saveProjectDocuments([document])).resolves.toMatchObject([{ project: { id: "cleanup" } }]);
    expect(mocks.asyncStorage.setItem).toHaveBeenCalledOnce();
  });
});

describe("independent design alternatives", () => {
  let stored: string | null;
  let files: Map<string, string>;
  beforeEach(() => {
    vi.resetAllMocks();
    stored = null;
    files = new Map();
    mocks.asyncStorage.getItem.mockImplementation(async () => stored);
    mocks.asyncStorage.setItem.mockImplementation(async (_key, value) => { stored = value; });
    mocks.getInfoAsync.mockImplementation(async uri => ({ exists: files.has(uri) }));
    mocks.readAsStringAsync.mockImplementation(async uri => {
      if (!files.has(uri)) throw new Error("Missing file");
      return files.get(uri);
    });
    mocks.writeAsStringAsync.mockImplementation(async (uri, value) => { files.set(uri, value); });
    mocks.copyAsync.mockImplementation(async ({ from, to }) => {
      if (!files.has(from)) throw new Error("Missing media");
      files.set(to, files.get(from)!);
    });
    mocks.readDirectoryAsync.mockImplementation(async directory => [...new Set([...files.keys()]
      .filter(uri => uri.startsWith(directory)).map(uri => uri.slice(directory.length).split("/")[0]))]);
    mocks.deleteAsync.mockImplementation(async uri => { files.delete(uri); });
  });

  async function saveSource() {
    const source = createEmptyProjectDocument({ id: "source", name: "Original", roomCaptures: structuredClone(roomsJSON) as RoomCapture[] });
    source.project.roomCaptures[0].roomScan!.nativeCapturedRoomJSON = "opaque-native-capture";
    source.project.fieldNotes = [{ id: "note", text: "Keep this", createdAt: "2026-10-01" }];
    files.set("file:///tmp/photo.jpg", "photo-data");
    files.set("file:///tmp/plan.pdf", "plan-data");
    source.project.photos = [{ id: "photo", uri: "file:///tmp/photo.jpg", capturedAt: "2026-10-01" }];
    source.project.blueprints = [{ id: "plan", name: "Plan.pdf", uri: "file:///tmp/plan.pdf", importedAt: "2026-10-01" }];
    source.scanMeasurementLogEntries = [{ projectId: "source", roomCaptureId: "room-1", scanId: "native", id: "measurement", history: [] } as any];
    await saveProjectDocuments([source]);
    return (await loadProjectDocuments())[0];
  }

  it("copies archives, media, relationships and measurement ownership and reopens independently", async () => {
    const original = await saveSource();
    const sourceArchive = original.project.roomCaptures[0].roomScan!.archiveUri!;
    const archiveBefore = files.get(sourceArchive);
    const { documents, projectId } = await duplicateProjectDocument("source", "  Option B  ");
    const alternative = documents[0];
    expect(alternative.project.name).toBe("Option B");
    expect(alternative.project.designAlternative).toMatchObject({ sourceProjectId: "source", sourceProjectName: "Original" });
    expect(alternative.scanMeasurementLogEntries[0].projectId).toBe(projectId);
    expect(alternative.project.spatialModel).toEqual(original.project.spatialModel);
    expect(alternative.project.roomCaptures.map(room => room.id)).toEqual(original.project.roomCaptures.map(room => room.id));
    expect(alternative.project.roomCaptures[0].roomScan!.archiveUri).not.toBe(sourceArchive);
    expect(alternative.project.photos[0].uri).not.toBe(original.project.photos[0].uri);
    expect(alternative.project.blueprints[0].uri).not.toBe(original.project.blueprints[0].uri);
    expect(files.get(alternative.project.photos[0].uri)).toBe("photo-data");
    expect(files.get(alternative.project.blueprints[0].uri)).toBe("plan-data");
    expect(documents[1]).toEqual(original);
    const reopened = (await loadProjectDocuments({ includeScans: true, projectId }))[0];
    expect(reopened.project.roomCaptures[0].roomScan!.nativeCapturedRoomJSON).toBe("opaque-native-capture");
    reopened.project.fieldNotes[0].text = "Alternative change";
    reopened.project.roomCaptures[0].roomScan!.nativeCapturedRoomJSON = "changed-copy";
    await saveProjectDocuments([reopened, documents[1]]);
    expect(files.get(sourceArchive)).toBe(archiveBefore);
    expect((await loadProjectDocuments())[1].project.fieldNotes[0].text).toBe("Keep this");
    // Removing the original's scans/media must not remove the alternative's copies.
    await saveProjectDocuments([reopened]);
    expect(files.has(sourceArchive)).toBe(false);
    const [survivor] = await loadProjectDocuments({ includeScans: true });
    expect(survivor.project.roomCaptures[0].roomScan!.nativeCapturedRoomJSON).toBe("changed-copy");
    expect(files.get(survivor.project.photos[0].uri)).toBe("photo-data");
  });

  it("refuses an incomplete copy if an archive is missing and preserves the source index", async () => {
    const original = await saveSource();
    const before = stored;
    files.delete(original.project.roomCaptures[0].roomScan!.archiveUri!);
    await expect(duplicateProjectDocument("source", "Option B")).rejects.toThrow("complete scan");
    expect(stored).toBe(before);
  });

  it("leaves the original intact if a media copy or final index write fails", async () => {
    await saveSource();
    const before = stored;
    mocks.copyAsync.mockRejectedValueOnce(new Error("Disk full"));
    await expect(duplicateProjectDocument("source", "Option B")).rejects.toThrow("Could not save");
    expect(stored).toBe(before);
    mocks.asyncStorage.setItem.mockRejectedValueOnce(new Error("Index full"));
    await expect(duplicateProjectDocument("source", "Option C")).rejects.toThrow("Could not save");
    expect(stored).toBe(before);
    expect((await loadProjectDocuments({ includeScans: true }))[0].project.roomCaptures[0].roomScan!.nativeCapturedRoomJSON).toBe("opaque-native-capture");
  });

  it("validates the name and source before making a copy", async () => {
    await expect(duplicateProjectDocument("missing", " ")).rejects.toThrow("between 1 and 120");
    await expect(duplicateProjectDocument("missing", "x".repeat(121))).rejects.toThrow("between 1 and 120");
    await expect(duplicateProjectDocument("missing", "Option")).rejects.toThrow("could not be found");
    expect(mocks.asyncStorage.setItem).not.toHaveBeenCalled();
  });
});
