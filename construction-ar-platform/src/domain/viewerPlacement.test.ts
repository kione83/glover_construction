import { describe, expect, it } from "vitest";
import { createEmptyProjectDocument, hydrateProjectDocument } from "../storage/projectDocument";
import roomsJSON from "./fixtures/threeRoomAssembly.json";
import type { RoomCapture } from "./projects";
import { editableScanObject, moveScanObject } from "./viewerPlacement";
import { capturedTransform, assemblyMatrix } from "./spatialTransforms";
const makeProject = () => {
  const rooms = structuredClone(roomsJSON) as RoomCapture[];
  const sample = rooms[0].roomScan!.elements[0];
  rooms[0].roomScan!.elements.push({ ...sample, id: "chair", kind: "furniture", category: "chair" }, { ...sample, id: "table", kind: "furniture", category: "table" });
  return createEmptyProjectDocument({ id: "placement", name: "Placement", roomCaptures: rooms }).project;
};
describe("saved scanned-object placement", () => {
  it("resolves only editable saved objects, not walls or background", () => {
    const p = makeProject(), id = p.roomCaptures[0].id;
    expect(editableScanObject(p, id, "chair")?.category).toBe("chair");
    expect(editableScanObject(p, id, p.roomCaptures[0].roomScan!.elements[0].id)).toBeUndefined();
    expect(editableScanObject(p, id)).toBeUndefined();
  });
  it("moves only the selected object in room X/Z, retaining elevation, scan and measurements", () => {
    const p = makeProject(), before = JSON.stringify(p), id = p.roomCaptures[0].id;
    const original = capturedTransform(editableScanObject(p, id, "chair")!.transform);
    const next = moveScanObject(p, {}, id, "chair", 0.1, -0.2);
    expect(Object.keys(next[id])).toEqual(["chair"]);
    expect(next[id].chair.position.x).toBeCloseTo(original.position.x + 0.1);
    expect(next[id].chair.position.z).toBeCloseTo(original.position.z - 0.2);
    expect(next[id].chair.position.y).toBe(original.position.y);
    expect(JSON.stringify(p)).toBe(before);
  });
  it("rotates both directions about the object center", () => {
    const p = makeProject(), id = p.roomCaptures[0].id;
    const initial = moveScanObject(p, {}, id, "chair", 0, 0);
    const left = moveScanObject(p, initial, id, "chair", 0, 0, -Math.PI / 36);
    expect(left[id].chair.position).toEqual(initial[id].chair.position);
    expect(assemblyMatrix(left[id].chair)).not.toEqual(assemblyMatrix(initial[id].chair));
    const restored = moveScanObject(p, left, id, "chair", 0, 0, Math.PI / 36);
    assemblyMatrix(restored[id].chair).forEach((v, i) => expect(v).toBeCloseTo(assemblyMatrix(initial[id].chair)[i]));
  });
  it("rejects capture edits and invalid input", () => {
    const p = makeProject(), id = p.roomCaptures[0].id, initial = {};
    expect(moveScanObject(p, initial, id, "chair", 1, 1, 0, true)).toBe(initial);
    expect(moveScanObject(p, initial, id, "chair", NaN, 1)).toBe(initial);
  });
  it("opens old documents and round-trips optional placement without changing captured data", () => {
    const p = makeProject(), id = p.roomCaptures[0].id;
    const old = hydrateProjectDocument(JSON.parse(JSON.stringify(createEmptyProjectDocument(p))))!.project;
    expect(old.spatialModel?.objectTransforms).toBeUndefined();
    const objects = moveScanObject(p, {}, id, "chair", 0.01, 0, Math.PI / 180);
    const saved = createEmptyProjectDocument({ ...p, spatialModel: { ...p.spatialModel!, objectTransforms: objects } });
    const reopened = hydrateProjectDocument(JSON.parse(JSON.stringify(saved)))!.project;
    expect(reopened.spatialModel?.objectTransforms).toEqual(objects);
  });
});
