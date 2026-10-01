import { describe, expect, it } from "vitest";
import { applyCatalogPlacementEdits, catalogViewerTransforms, moveCatalogPlacement } from "./catalogPlacement";
import { createEmptyProjectDocument, hydrateProjectDocument } from "../storage/projectDocument";
import { canonicalTransform } from "./spatialTransforms";
import type { PlacedObject } from "./projects";
const pose = canonicalTransform({ position: { x: 1, y: 0.5, z: 2 }, rotation: { pitch: 0, yaw: 0.2, roll: 0 } });
const object: PlacedObject = { id: "proposal", catalogObjectId: "furniture-sofa", roomCaptureId: "room", anchorId: "original-anchor", displayName: "Sofa", transform: canonicalTransform({ position: { x: 100, y: 0.5, z: 2 } }), transformSpace: "ar-world", roomLocalTransform: pose, arSessionId: "original-session", dimensions: { width: 2, height: 1, depth: 1, unit: "m" }, status: "active", placedAt: "2026-10-01", updatedAt: "2026-10-01" };
const makeProject = () => createEmptyProjectDocument({ id: "p", name: "Layout", roomCaptures: [{ id: "room", name: "Room", source: "manual", status: "completed", surfaces: [], unit: "m" }], placedObjects: [structuredClone(object), { ...structuredClone(object), id: "neighbor" }] }).project;
describe("saved catalog layout edits", () => {
  it("moves and rotates only the selected proposal about its center and retains the source AR pose", () => {
    const project = makeProject(), before = JSON.stringify(project);
    let edits = moveCatalogPlacement(project, {}, "proposal", 0.1, 0.2, -0.3);
    edits = moveCatalogPlacement(project, edits, "proposal", 0, 0, 0, Math.PI / 2);
    expect(edits.proposal.position.x).toBeCloseTo(1.1);
    expect(edits.proposal.position.y).toBeCloseTo(0.7);
    expect(edits.proposal.position.z).toBeCloseTo(1.7);
    const saved = applyCatalogPlacementEdits(project, edits);
    expect(saved.placedObjects[0].transform).toEqual(object.transform);
    expect(saved.placedObjects[0].arSessionId).toBe("original-session");
    expect(saved.placedObjects[0].dimensions).toEqual(object.dimensions);
    expect(saved.placedObjects[1]).toBe(project.placedObjects[1]);
    expect(JSON.stringify(project)).toBe(before);
  });
  it("bridges one prefixed native feature pose and round-trips through project hydration", () => {
    const project = makeProject(), edits = moveCatalogPlacement(project, {}, "proposal", 1, 0, 0);
    expect(catalogViewerTransforms(project, edits)).toEqual({ room: { "placed:proposal": edits.proposal } });
    const saved = createEmptyProjectDocument(applyCatalogPlacementEdits(project, edits));
    const reopened = hydrateProjectDocument(JSON.parse(JSON.stringify(saved)))!.project;
    expect(reopened.placedObjects[0].roomLocalTransform).toEqual(edits.proposal);
    expect(reopened.placedObjects).toHaveLength(2);
    expect(reopened.placedObjects[0].anchorId).toBe("proposal-layout-unverified");
    expect(reopened.validationIssues).toContainEqual(expect.objectContaining({ ruleId: "attach-to-supported-surface", objectId: "proposal", severity: "warning" }));
  });
  it("rejects unaligned, deleted, missing and nonfinite placement edits", () => {
    const project = makeProject(), edits = {};
    project.placedObjects[0].roomLocalTransform = undefined;
    project.placedObjects[1].status = "deleted";
    expect(moveCatalogPlacement(project, edits, "proposal", 1, 0, 0)).toBe(edits);
    expect(moveCatalogPlacement(project, edits, "neighbor", 1, 0, 0)).toBe(edits);
    expect(moveCatalogPlacement(project, edits, "missing", 1, 0, 0)).toBe(edits);
    expect(moveCatalogPlacement(makeProject(), edits, "proposal", NaN, 0, 0)).toBe(edits);
  });
});
