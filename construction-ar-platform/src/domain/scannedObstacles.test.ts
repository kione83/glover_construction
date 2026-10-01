import { describe, expect, it } from "vitest";
import { createEmptyProjectDocument } from "../storage/projectDocument";
import { type RoomScanElement } from "./projects";
import { canonicalTransform } from "./spatialTransforms";
import { validateProject } from "./validationService";
import { applyCatalogPlacementEdits } from "./catalogPlacement";
function fixture() {
  const pose = canonicalTransform();
  const obstacle: RoomScanElement = { id: "cabinet", kind: "furniture", category: "storage-cabinet", representation: "cabinet", dimensions: { width: 1, height: 1, depth: 1, unit: "m" }, transform: pose };
  return createEmptyProjectDocument({ id: "p", name: "Fit", roomCaptures: [{ id: "r", name: "Kitchen", source: "roomplan", status: "completed", unit: "m", surfaces: [], roomScan: { version: 1, source: "roomplan", capturedAt: "2026-10-01", elements: [obstacle], portal: { format: "construction-ar-room-scan", version: 1 } } }], placedObjects: [{ id: "panel", catalogObjectId: "electrical-panel-small", displayName: "Panel", roomCaptureId: "r", anchorId: "a", transform: canonicalTransform({ position: { x: 100, y: 0, z: 0 } }), roomLocalTransform: pose, transformSpace: "ar-world", dimensions: { width: 0.4, height: 0.9, depth: 0.15, unit: "m" }, status: "active", placedAt: "2026-10-01", updatedAt: "2026-10-01" }] }).project;
}
const issues = (project: ReturnType<typeof fixture>) => validateProject(project).filter(issue => issue.ruleId === "scanned-obstacle-check");
describe("scanned obstacle fit review", () => {
  it("checks canonical room coordinates and identifies the conflicting scanned object", () => {
    const result = issues(fixture());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ severity: "warning", objectId: "panel", relatedScanElementId: "cabinet", message: expect.stringContaining("may overlap scanned storage cabinet in Kitchen") });
  });
  it("checks clearance when physical envelopes do not overlap", () => {
    const project = fixture();
    project.roomCaptures[0].roomScan!.elements[0].dimensions = { width: 0.1, height: 0.1, depth: 0.1, unit: "m" };
    project.roomCaptures[0].roomScan!.elements[0].roomLocalTransform = canonicalTransform({ position: { x: 0, y: 0, z: 0.3 } });
    expect(issues(project)[0].message).toContain("planning clearance envelope");
  });
  it("respects rotated sizes, room ownership, and inactive or unaligned placements", () => {
    const project = fixture();
    project.roomCaptures[0].roomScan!.elements[0].dimensions = { width: 4, height: 1, depth: 0.1, unit: "m" };
    project.roomCaptures[0].roomScan!.elements[0].roomLocalTransform = canonicalTransform({ position: { x: 0, y: 0, z: 1.2 }, rotation: { pitch: 0, yaw: Math.PI/2, roll: 0 } });
    expect(issues(project)).toHaveLength(1);
    project.placedObjects[0].roomCaptureId = "other";
    expect(issues(project)).toHaveLength(0);
    project.placedObjects[0].roomCaptureId = "r";
    project.placedObjects[0].status = "deleted";
    expect(issues(project)).toHaveLength(0);
    project.placedObjects[0].status = "active";
    delete project.placedObjects[0].roomLocalTransform;
    expect(issues(project)).toHaveLength(0);
  });
  it("uses saved assembly overrides for roots and their children, then clears stale warnings on save", () => {
    const project = fixture();
    const root = project.roomCaptures[0].roomScan!.elements[0];
    project.roomCaptures[0].roomScan!.elements.push({ ...root, id: "component", parentObjectId: "cabinet" });
    expect(issues(project)).toHaveLength(2);
    project.validationIssues = validateProject(project);
    project.spatialModel!.objectTransforms = { r: { cabinet: canonicalTransform({ position: { x: 5, y: 0, z: 0 } }) } };
    expect(issues(project)).toHaveLength(0);
    const saved = applyCatalogPlacementEdits(project, {});
    expect(saved.validationIssues.filter(issue => issue.ruleId === "scanned-obstacle-check")).toHaveLength(0);
    expect(root.transform).toEqual(canonicalTransform());
  });
  it("does not treat support walls, door openings or invalid geometry as solid obstacles", () => {
    const project = fixture();
    const element = project.roomCaptures[0].roomScan!.elements[0];
    project.roomCaptures[0].roomScan!.elements = [
      { ...element, kind: "wall" }, { ...element, id: "door", kind: "door" },
      { ...element, id: "invalid", dimensions: { ...element.dimensions, width: 0 } },
    ];
    expect(issues(project)).toHaveLength(0);
  });
});
