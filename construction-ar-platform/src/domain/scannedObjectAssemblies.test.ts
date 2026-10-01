import { describe, expect, it } from "vitest";
import type { RoomScanData, RoomScanElement } from "./projects";
import { canonicalTransform, composeTransforms, relativeTransform } from "./spatialTransforms";
import { normalizeScanObjects } from "./scannedObjects";
import { scannedObjectRoots } from "./scannedObjectAssemblies";
import { savedViewerScan } from "./savedRoomModel";
import { editableScanObject, moveScanObject, viewerObjectTransforms } from "./viewerPlacement";
import { createEmptyProjectDocument, hydrateProjectDocument } from "../storage/projectDocument";

const pose = (x: number, y = 0, z = 0, yaw = 0) => canonicalTransform({ position: { x, y, z }, rotation: { pitch: 0, yaw, roll: 0 } });
function fixture(category: string) {
  const root = pose(2, 0.5, -1, 0.4);
  const kind = category === "appliance" ? "fixture" : category === "storage" ? "built-in" : "furniture";
  const element = (id: string, category: string, transform: ReturnType<typeof pose>): RoomScanElement => ({ id, category, kind, representation: "generic-object", dimensions: { width: 1, height: 1, depth: 1, unit: "m" }, transform, roomLocalTransform: transform });
  const scan: RoomScanData = { version: 1, source: "roomplan", capturedAt: "2026-09-17", portal: { format: "construction-ar-room-scan", version: 1 }, measurements: [],
    elements: [element("root", category, root), element("child", "component", composeTransforms(root, pose(0.2, 0.3, 0.1, -0.2))), element("grandchild", "component", composeTransforms(root, pose(-0.1, 0.1, 0.3, 0.1))), element("neighbor", category, pose(2.1))],
    nativeCapturedRoomJSON: JSON.stringify({ objects: [{ identifier: "root" }, { identifier: "child", parentIdentifier: "root" }, { identifier: "grandchild", parentIdentifier: "child" }, { identifier: "neighbor" }] }) };
  const project = createEmptyProjectDocument({ id: "project", name: "Hierarchy", roomCaptures: [{ id: "room", name: "Room", status: "completed", source: "roomplan", unit: "m", surfaces: [], roomScan: scan }] }).project;
  return { scan: project.roomCaptures[0].roomScan!, project };
}
function close(a: number[], b: number[]) { a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9)); }

describe("explicit scanned object assemblies", () => {
  for (const category of ["appliance", "storage", "table", "chair"]) it(`moves and rotates the entire ${category} assembly, including selection through a component`, () => {
    const { scan, project } = fixture(category), original = JSON.stringify(scan);
    expect(editableScanObject(project, "room", "grandchild")?.id).toBe("root");
    let overrides = moveScanObject(project, {}, "room", "child", 0.3, -0.2);
    overrides = moveScanObject(project, overrides, "room", "grandchild", 0, 0, Math.PI / 2);
    expect(Object.keys(overrides.room)).toEqual(["root"]);
    const render = savedViewerScan(scan, overrides.room);
    const root = render.elements.find(e => e.id === "root")!;
    expect(root.transform.position.y).toBe(0.5);
    for (const id of ["child", "grandchild"]) {
      const before = scan.elements.find(e => e.id === id)!;
      const after = render.elements.find(e => e.id === id)!;
      close(relativeTransform(root.transform, after.transform)!.matrix!, relativeTransform(scan.elements[0].transform, before.transform)!.matrix!);
      expect("objectRootId" in after ? after.objectRootId : undefined).toBe("root");
    }
    close(render.elements[3].transform.matrix!, scan.elements[3].transform.matrix!);
    expect(JSON.stringify(scan)).toBe(original);
    expect(render.elements).toHaveLength(scan.elements.length);
  });

  it("recovers relationships from old native archives, persists only additive metadata, and round-trips edits without duplicates", () => {
    const { scan, project } = fixture("appliance");
    expect(scan.elements[1].parentObjectId).toBe("root");
    const overrides = moveScanObject(project, {}, "room", "child", 1, 2, 0.2);
    const document = createEmptyProjectDocument({ ...project, spatialModel: { ...project.spatialModel!, objectTransforms: overrides } });
    const reopened = hydrateProjectDocument(JSON.parse(JSON.stringify(document)))!.project;
    const reloaded = reopened.roomCaptures[0].roomScan!;
    expect(reloaded.elements).toEqual(scan.elements);
    expect(reloaded.nativeCapturedRoomJSON).toBe(scan.nativeCapturedRoomJSON);
    expect(viewerObjectTransforms(reopened, reopened.spatialModel!.objectTransforms!)).toEqual(viewerObjectTransforms(project, overrides));
    const noArchive = { ...reloaded, nativeCapturedRoomJSON: undefined };
    expect(scannedObjectRoots(noArchive).get("grandchild")).toBe("root");
  });

  it("recovers a legacy component-only edit as one root pose and removes stale component overrides on the next edit", () => {
    const { scan, project } = fixture("storage");
    const legacy = { room: { child: composeTransforms(pose(3), scan.elements[1].transform) } };
    const render = savedViewerScan(scan, legacy.room);
    close(render.elements[1].transform.matrix!, legacy.room.child.matrix!);
    expect(render.elements[0].transform.position.x).toBeCloseTo(5);
    const next = moveScanObject(project, legacy, "room", "child", 0.1, 0);
    expect(Object.keys(next.room)).toEqual(["root"]);
    expect(next.room.root.position.x).toBeCloseTo(5.1);
    const rootWins = savedViewerScan(scan, { ...legacy.room, root: pose(8) });
    expect(rootWins.elements[0].transform.position.x).toBe(8);
    close(rootWins.elements[1].transform.matrix!, composeTransforms(pose(8), relativeTransform(scan.elements[0].transform, scan.elements[1].transform)!).matrix!);
  });

  it("never groups similar/nearby objects without ownership, architecture, missing parents, or cyclic links", () => {
    const { scan } = fixture("chair");
    const standalone = { ...scan, nativeCapturedRoomJSON: undefined, elements: scan.elements.map(e => ({ ...e, parentObjectId: undefined })) };
    expect([...scannedObjectRoots(standalone).entries()].every(([id, root]) => id === root)).toBe(true);
    const malformed = { ...standalone, elements: standalone.elements.map((e, i) => ({ ...e, parentObjectId: i === 0 ? "child" : i === 1 ? "root" : "missing" })) };
    expect([...scannedObjectRoots(malformed).entries()].every(([id, root]) => id === root)).toBe(true);
    expect(normalizeScanObjects({ ...standalone, nativeCapturedRoomJSON: "invalid" }, "room").elements).toHaveLength(4);
    const architectural = { ...standalone, elements: [{ ...standalone.elements[0], kind: "wall" as const }, { ...standalone.elements[1], parentObjectId: "root" }] };
    expect(scannedObjectRoots(architectural).get("child")).toBe("child");
  });
});
