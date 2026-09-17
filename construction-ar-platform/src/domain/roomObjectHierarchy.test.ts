import { describe, expect, it } from "vitest";
import roomsJSON from "./fixtures/threeRoomAssembly.json";
import { identityTransform, setRoomProjectTransform, connectRoomsInProject, type PlacedObject, type RoomCapture } from "./projects";
import { createEmptyProjectDocument, hydrateProjectDocument } from "../storage/projectDocument";
import { alignRoomFeatures, assemblyMatrix, canonicalTransform, capturedTransform, composeTransforms, inverseTransform, relativeTransform, roomToARFromPointPairs } from "./spatialTransforms";
import { normalizeProjectHierarchy, placeObjectInRoom } from "./roomObjectHierarchy";
import { initialAssemblyTransforms, moveAssemblyRoom, rotateAssemblyRoom, saveAssemblyToProject, updateAssemblyTransform } from "./roomAssembly";
import { savedRoomModel } from "./savedRoomModel";
import { transformPoint } from "./roomScanMesh";

const pose = (x: number, yaw = 0) => canonicalTransform({ ...identityTransform(), position: { x, y: 0.5, z: 2 }, rotation: { pitch: 0.1, yaw, roll: 0.2 }, scale: { x: 1.1, y: 1, z: 0.9 } });
function placed(id: string, roomCaptureId = "room-1"): PlacedObject {
  return { id, roomCaptureId, catalogObjectId: "furniture-armchair", anchorId: `anchor-${id}`, displayName: "Chair", transform: pose(2), transformSpace: "room-local", roomLocalTransform: pose(2), dimensions: { width: 0.5, depth: 0.6, height: 1, unit: "m" }, status: "active", placedAt: "2026-09-14", updatedAt: "2026-09-14" };
}
function document() {
  return createEmptyProjectDocument({ id: "hierarchy", name: "Building", roomCaptures: structuredClone(roomsJSON) as RoomCapture[], placedObjects: [placed("a"), placed("b", "room-2")] });
}
function closeMatrices(a: number[], b: number[]) { a.forEach((value, index) => expect(value).toBeCloseTo(b[index], 10)); }

describe("room-local hierarchy", () => {
  it("persists scanned and placed local matrices with existing type/measurement metadata", () => {
    const doc = document(), before = doc.project;
    const reopened = hydrateProjectDocument(JSON.parse(JSON.stringify(doc)))!.project;
    expect(reopened.placedObjects[0].roomLocalTransform!.matrix).toEqual(before.placedObjects[0].roomLocalTransform!.matrix);
    expect(reopened.placedObjects[0].objectTypeId).toBe("catalog:furniture-armchair");
    expect(reopened.placedObjects[0].objectMeasurements).toEqual(before.placedObjects[0].objectMeasurements);
    expect(reopened.roomCaptures[0].roomScan!.objectTypes).toEqual(before.roomCaptures[0].roomScan!.objectTypes);
    expect(reopened.roomCaptures[0].roomScan!.elements.map(e => e.roomLocalTransform)).toEqual(before.roomCaptures[0].roomScan!.elements.map(e => e.roomLocalTransform));
  });

  it("converts AR placement using its recorded room-to-session mapping, not the assembly pose", () => {
    const p = document().project, local = pose(4, 0.7), worldFromRoom = pose(20, -0.3);
    const world = composeTransforms(worldFromRoom, local);
    p.placedObjects = [placeObjectInRoom(placed("a"), world, "session-1", worldFromRoom)];
    p.spatialModel!.roomTransforms["room-1"] = pose(100, 2);
    const normalized = normalizeProjectHierarchy(p).placedObjects[0];
    closeMatrices(normalized.roomLocalTransform!.matrix!, local.matrix!);
    expect(normalized.transform.matrix).toEqual(world.matrix);
    expect(normalized.arSessionId).toBe("session-1");
  });

  it("derives explicitly project-space legacy placements only once", () => {
    const p = document().project, parent = pose(10), local = pose(2);
    p.spatialModel!.roomTransforms["room-1"] = parent;
    p.placedObjects = [{ ...placed("a"), roomLocalTransform: undefined, transformSpace: "project-local", transform: composeTransforms(parent, local) }];
    const first = normalizeProjectHierarchy(p);
    closeMatrices(first.placedObjects[0].roomLocalTransform!.matrix!, local.matrix!);
    first.spatialModel!.roomTransforms["room-1"] = pose(30);
    expect(normalizeProjectHierarchy(first).placedObjects[0].roomLocalTransform).toEqual(first.placedObjects[0].roomLocalTransform);
  });

  it("preserves unknown legacy AR data without fabricating room alignment", () => {
    const p = document().project;
    p.placedObjects = [{ ...placed("old"), roomLocalTransform: undefined, transformSpace: undefined }];
    const result = normalizeProjectHierarchy(p);
    expect(result.placedObjects[0].spatialStatus).toBe("needs-alignment");
    expect(result.placedObjects[0].roomLocalTransform).toBeUndefined();
    expect(result.placedObjects[0].transform).toEqual(p.placedObjects[0].transform);
    expect(savedRoomModel(result, "project").rooms[0].placedObjects).toEqual([]);
  });

  it("recognizes old manual placements through their saved room-surface anchor", () => {
    const p = document().project;
    p.roomCaptures[0].surfaces = [{ id: "floor", kind: "floor", label: "Floor" }];
    p.anchors = [{ id: "anchor-old", roomCaptureId: "room-1", reference: { surfaceId: "floor", kind: "floor" }, transform: identityTransform() }];
    p.placedObjects = [{ ...placed("old"), roomLocalTransform: undefined, transformSpace: undefined }];
    expect(normalizeProjectHierarchy(p).placedObjects[0].spatialStatus).toBe("room-local");
  });

  it("defaults missing scan/room transforms safely and converts legacy RoomPlan yaw once", () => {
    const doc = document();
    doc.project.spatialModel = undefined;
    const scan = doc.project.roomCaptures[0].roomScan!;
    const object = scan.elements.find(e => e.kind === "furniture")!;
    object.roomLocalTransform = undefined;
    object.transform = { rotation: { pitch: 0, yaw: 0.4, roll: 0 } } as typeof object.transform;
    const reopened = hydrateProjectDocument({ ...doc, schemaVersion: 7 })!.project;
    const migrated = reopened.roomCaptures[0].roomScan!.elements.find(e => e.id === object.id)!;
    expect(migrated.roomLocalTransform!.rotation.yaw).toBeCloseTo(-0.4);
    expect(migrated.transform).toEqual(object.transform);
    expect(initialAssemblyTransforms(reopened)["room-1"]).toBeDefined();
    expect(normalizeProjectHierarchy(reopened).roomCaptures[0].roomScan!.elements.find(e => e.id === object.id)!.roomLocalTransform).toEqual(migrated.roomLocalTransform);
    expect(capturedTransform(undefined).matrix).toEqual(assemblyMatrix(identityTransform()));
  });

  it("defaults explicitly room-local missing placement transforms without crashing", () => {
    const p = document().project;
    p.placedObjects = [{ ...placed("old"), roomLocalTransform: undefined, transform: undefined as unknown as PlacedObject["transform"] }];
    expect(normalizeProjectHierarchy(p).placedObjects[0].roomLocalTransform!.matrix).toEqual(assemblyMatrix(identityTransform()));
  });

  it("retains useful local data for orphaned instances while marking the room relationship unresolved", () => {
    const p = document().project;
    p.placedObjects = [placed("orphan", "missing-room")];
    const object = normalizeProjectHierarchy(p).placedObjects[0];
    expect(object.roomLocalTransform!.matrix).toEqual(p.placedObjects[0].roomLocalTransform!.matrix);
    expect(object.spatialStatus).toBe("needs-alignment");
  });

  it("child follows parent translation/rotation while another room and all child locals remain unchanged", () => {
    const p = document().project, originals = structuredClone(p.placedObjects), initial = initialAssemblyTransforms(p);
    const parent = rotateAssemblyRoom(moveAssemblyRoom(initial["room-1"], "x", 8), Math.PI / 2, { x: 0, y: 0, z: 0 });
    const next = saveAssemblyToProject(p, { ...initial, "room-1": parent });
    const model = savedRoomModel(next, "project");
    closeMatrices(composeTransforms(model.rooms[0].transform, model.rooms[0].placedObjects[0].transform).matrix!, composeTransforms(parent, originals[0].roomLocalTransform).matrix!);
    expect(next.placedObjects).toEqual(originals);
    closeMatrices(model.rooms[1].transform.matrix!, assemblyMatrix(initial["room-2"]));
    expect(model.rooms[1].placedObjects[0].transform.matrix).toEqual(originals[1].roomLocalTransform!.matrix);
  });

  it("keeps four grouped scan objects as four independent rendered children", () => {
    const p = document().project, scan = p.roomCaptures[0].roomScan!;
    const chair = scan.elements.find(e => e.kind === "furniture")!;
    scan.elements = [0, 1, 2, 3].map(i => ({ ...chair, id: `chair-${i}`, confidence: 0.95, transform: pose(i, i), roomLocalTransform: pose(i, i) }));
    scan.measurements = [];
    const model = savedRoomModel(normalizeProjectHierarchy(p), "project");
    expect(model.rooms[0].roomScan!.objectTypes).toHaveLength(1);
    expect(model.rooms[0].roomScan!.objectTypes![0].quantity).toBe(4);
    expect(model.rooms[0].roomScan!.elements).toHaveLength(4);
    expect(new Set(model.rooms[0].roomScan!.elements.map(e => JSON.stringify(e.transform.matrix))).size).toBe(4);
    expect(model.rooms[0].placedObjects).toHaveLength(1); // additional proposed placement
  });

  it("single-room viewer uses room coordinates even after assembly adjustment", () => {
    const p = document().project;
    p.spatialModel!.roomTransforms["room-1"] = pose(99, 1);
    const model = savedRoomModel(p, "room", "room-1");
    expect(model.rooms[0].transform.matrix).toEqual(assemblyMatrix(identityTransform()));
    expect(model.rooms[0].placedObjects[0].transform.matrix).toEqual(p.placedObjects[0].roomLocalTransform!.matrix);
  });

  it("locks room transformations in editor helpers, save boundary and manual connection paths", () => {
    const p = document().project, transforms = initialAssemblyTransforms(p);
    const locked = saveAssemblyToProject(p, transforms, "room-1");
    const moved = moveAssemblyRoom(transforms["room-1"], "x", 40);
    expect(updateAssemblyTransform(transforms, "room-1", moved, "room-1")).toBe(transforms);
    expect(setRoomProjectTransform(locked, "room-1", moved)).toBe(locked);
    expect(saveAssemblyToProject(locked, { ...transforms, "room-1": moved }, "room-1").spatialModel!.roomTransforms["room-1"]).toEqual(locked.spatialModel!.roomTransforms["room-1"]);
    expect(connectRoomsInProject(locked, { id: "c", parentRoomId: "room-2", childRoomId: "room-1", transform: moved, connectionType: "door", alignmentMethod: "user-assisted", elevationChangeMeters: 0 })).toBe(locked);
  });

  it("repeated save/reopen/rotate/translate does not accumulate child transform drift", () => {
    let doc = document();
    const childMatrices = doc.project.placedObjects.map(object => object.roomLocalTransform!.matrix);
    const scanLocals = doc.project.roomCaptures.map(room => room.roomScan!.elements.map(e => e.roomLocalTransform?.matrix));
    let expectedRoom = canonicalTransform(initialAssemblyTransforms(doc.project)["room-2"]);
    for (let i = 0; i < 40; i++) {
      expectedRoom = rotateAssemblyRoom(moveAssemblyRoom(expectedRoom, "z", 0.125), Math.PI / 180, { x: 0, y: 0, z: 0 });
      doc.project = saveAssemblyToProject(doc.project, { ...initialAssemblyTransforms(doc.project), "room-2": expectedRoom }, "room-1");
      doc = hydrateProjectDocument(JSON.parse(JSON.stringify(doc)))!;
      expect(doc.project.placedObjects.map(object => object.roomLocalTransform!.matrix)).toEqual(childMatrices);
      expect(doc.project.roomCaptures.map(room => room.roomScan!.elements.map(e => e.roomLocalTransform?.matrix))).toEqual(scanLocals);
      closeMatrices(doc.project.spatialModel!.roomTransforms["room-2"].matrix!, expectedRoom.matrix!);
    }
  });
});

describe("coordinate conversion", () => {
  it("inverts full rotation/translation/scale and respects matrix authority over stale TRS", () => {
    const t = pose(15, 0.6), stale = { ...t, position: { x: 999, y: 999, z: 999 } };
    expect(canonicalTransform(stale).position.x).toBe(15);
    closeMatrices(composeTransforms(t, inverseTransform(t)!).matrix!, assemblyMatrix(identityTransform()));
    expect(inverseTransform(canonicalTransform({ scale: { x: 0, y: 1, z: 1 } }))).toBeNull();
  });
  it("aligns feature matrices exactly while retaining child poses", () => {
    const roomA = pose(10, 0.6), featureA = pose(3, 0.2), featureB = pose(1, -0.4);
    const roomB = alignRoomFeatures(roomA, featureA, featureB)!;
    closeMatrices(composeTransforms(roomB, featureB).matrix!, composeTransforms(roomA, featureA).matrix!);
    closeMatrices(composeTransforms(roomA, relativeTransform(roomA, roomB)!).matrix!, roomB.matrix!);
  });
  it("registers two physical reference centers without incorporating assembly coordinates", () => {
    const mapping = canonicalTransform({ position: { x: 8, y: -1, z: 3 }, rotation: { pitch: 0, yaw: 0.6, roll: 0 } });
    const a = { x: 1, y: 1, z: 2 }, b = { x: 3, y: 1.2, z: 5 };
    const result = roomToARFromPointPairs(a, b, transformPoint(a, mapping), transformPoint(b, mapping))!;
    closeMatrices(result.matrix!, mapping.matrix!);
    expect(roomToARFromPointPairs(a, a, a, a)).toBeNull();
    expect(roomToARFromPointPairs(a, b, a, { x: 100, y: 1, z: 5 })).toBeNull();
  });
});
