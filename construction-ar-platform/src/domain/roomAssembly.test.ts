import { describe, expect, it } from "vitest";
import roomsJSON from "./fixtures/threeRoomAssembly.json";
import { identityTransform, type RoomCapture, removeRoomFromProject } from "./projects";
import { createEmptyProjectDocument, hydrateProjectDocument } from "../storage/projectDocument";
import { assemblyMatrix, initialAssemblyTransforms, moveAssemblyRoom, rotateAssemblyRoom, roomAssemblyBounds, roomDimensionLabel, saveAssemblyToProject, updateAssemblyTransform } from "./roomAssembly";
import { transformPoint } from "./roomScanMesh";
const rooms = roomsJSON as RoomCapture[];
const project = () => createEmptyProjectDocument({ id: "assembly", name: "Building", roomCaptures: structuredClone(rooms) }).project;
const point = { x: 2, y: 1.5, z: -2.5 };

describe("three saved room assembly", () => {
  it("stages three separate rooms, preserving existing placement and scan bytes", () => {
    const p = project(), before = JSON.stringify(p.roomCaptures), transforms = initialAssemblyTransforms(p);
    expect(Object.keys(transforms)).toHaveLength(3);
    expect(transforms[rooms[1].id].position.x - transforms[rooms[0].id].position.x).toBe(5.5);
    const saved = saveAssemblyToProject(p, { ...transforms, [rooms[0].id]: identityTransform() }, rooms[0].id);
    expect(assemblyMatrix(initialAssemblyTransforms(saved)[rooms[0].id])).toEqual(assemblyMatrix(identityTransform()));
    expect(JSON.stringify(saved.roomCaptures)).toBe(before);
  });

  it("locks A; translates and rotates B; independently positions C", () => {
    const p = project(), transforms = initialAssemblyTransforms(p), a = rooms[0].id, b = rooms[1].id, c = rooms[2].id;
    expect(updateAssemblyTransform(transforms, a, moveAssemblyRoom(transforms[a], "x", 9), a)).toBe(transforms);
    let moved = updateAssemblyTransform(transforms, b, moveAssemblyRoom(transforms[b], "y", 0.25), a);
    moved = updateAssemblyTransform(moved, b, rotateAssemblyRoom(moved[b], Math.PI / 2, roomAssemblyBounds(rooms[1]).center), a);
    expect(moved[a]).toBe(transforms[a]); expect(moved[c]).toBe(transforms[c]);
    const next = updateAssemblyTransform(moved, c, moveAssemblyRoom(moved[c], "z", -5), a);
    expect(next[b]).toBe(moved[b]); expect(next[c].position.z).toBe(moved[c].position.z - 5);
  });

  it("preserves center, all relative geometry, tilt and scale through root rotation", () => {
    const t = { ...identityTransform(), position: { x: 10, y: 2, z: -7 }, rotation: { pitch: 0.15, yaw: 0.6, roll: -0.2 }, scale: { x: 1.2, y: 1.2, z: 1.2 } };
    const center = roomAssemblyBounds(rooms[0]).center;
    const before = { ...t, matrix: assemblyMatrix(t) }, after = rotateAssemblyRoom(t, Math.PI / 2, center);
    const p0 = transformPoint(center, before), p1 = transformPoint(center, after);
    for (const axis of ["x", "y", "z"] as const) expect(p1[axis]).toBeCloseTo(p0[axis], 10);
    function distance(a: typeof point, b: typeof point) { return Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z); }
    expect(distance(transformPoint(point, before), p0)).toBeCloseTo(distance(transformPoint(point, after), p1), 10);
    expect(after.scale).toEqual(t.scale);
  });

  it("saves/reopens lock and transforms; reset changes only assembly placement", () => {
    const p = project(), transforms = initialAssemblyTransforms(p);
    transforms[rooms[1].id] = moveAssemblyRoom(transforms[rooms[1].id], "z", 12);
    const saved = saveAssemblyToProject(p, transforms, rooms[0].id);
    const reopened = hydrateProjectDocument(JSON.parse(JSON.stringify(createEmptyProjectDocument(saved))))!.project;
    expect(Object.values(initialAssemblyTransforms(reopened)).map(assemblyMatrix)).toEqual(Object.values(transforms).map(assemblyMatrix));
    expect(reopened.spatialModel?.lockedRoomId).toBe(rooms[0].id);
    const reset = saveAssemblyToProject(reopened, initialAssemblyTransforms(reopened, true));
    expect(reset.spatialModel?.lockedRoomId).toBeUndefined();
    expect(reset.roomCaptures).toEqual(p.roomCaptures);
    expect(Object.values(reset.spatialModel!.roomTransforms).map(assemblyMatrix)).toEqual(Object.values(initialAssemblyTransforms(p)).map(assemblyMatrix));
    expect(removeRoomFromProject(saved, rooms[0].id).spatialModel?.lockedRoomId).toBeUndefined();
  });

  it("labels only available room dimensions with H/W/L and original units", () => {
    expect(roomDimensionLabel(rooms[0])).toBe("H: 3.00 m · W: 4.00 m · L: 5.00 m");
    const room = structuredClone(rooms[0]); delete room.roomScan!.ceilingHeight;
    expect(roomDimensionLabel(room)).toBe("W: 4.00 m · L: 5.00 m");
    expect(JSON.stringify(rooms)).toBe(JSON.stringify(roomsJSON));
  });
});
