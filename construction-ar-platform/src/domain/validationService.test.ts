import { describe, expect, it } from "vitest";

import { createEmptyProjectDocument } from "../storage/projectDocument";
import { validateProject } from "./validationService";
import type { Project } from "./projects";

const transform = { position: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 }, scale: { x: 1, y: 1, z: 1 } };

function projectWith(objects: Project["placedObjects"], anchors: Project["anchors"]): Project {
  return createEmptyProjectDocument({ id: "test-project", name: "Test project", roomCaptures: [{ id: "room-1", name: "Room", status: "completed", source: "manual", unit: "m", surfaces: [{ id: "wall-1", kind: "wall", label: "Wall" }, { id: "ceiling-1", kind: "ceiling", label: "Ceiling" }] }], placedObjects: objects, anchors }).project;
}

describe("validateProject", () => {
  it("reports an unsupported surface attachment", () => {
    const project = projectWith([{ id: "object-1", catalogObjectId: "electrical-outlet-duplex", roomCaptureId: "room-1", anchorId: "anchor-1", displayName: "Duplex Outlet", transform, dimensions: { width: 0.08, height: 0.12, depth: 0.04, unit: "m" }, status: "active", placedAt: "2026-01-01", updatedAt: "2026-01-01" }], [{ id: "anchor-1", roomCaptureId: "room-1", reference: { surfaceId: "ceiling-1", kind: "ceiling" }, transform }]);
    expect(validateProject(project, "2026-01-02")).toMatchObject([{ ruleId: "attach-to-supported-surface", severity: "error" }]);
  });

  it("reports overlapping objects in the same room", () => {
    const objects = ["object-1", "object-2"].map((id) => ({ id, catalogObjectId: "electrical-outlet-duplex", roomCaptureId: "room-1", anchorId: `anchor-${id}`, displayName: id, transform, dimensions: { width: 0.08, height: 0.12, depth: 0.04, unit: "m" as const }, status: "active" as const, placedAt: "2026-01-01", updatedAt: "2026-01-01" }));
    const anchors = objects.map((object) => ({ id: object.anchorId, roomCaptureId: "room-1", reference: { surfaceId: "wall-1", kind: "wall" as const }, transform }));
    expect(validateProject(projectWith(objects, anchors), "2026-01-02").some((item) => item.ruleId === "object-collision-check")).toBe(true);
  });

  it("reports an object in a clearance area", () => {
    const panel = { id: "panel", catalogObjectId: "electrical-panel-small", roomCaptureId: "room-1", anchorId: "panel-anchor", displayName: "Electrical Panel", transform, dimensions: { width: 0.4, height: 0.9, depth: 0.15, unit: "m" as const }, status: "active" as const, placedAt: "2026-01-01", updatedAt: "2026-01-01" };
    const outlet = { id: "outlet", catalogObjectId: "electrical-outlet-duplex", roomCaptureId: "room-1", anchorId: "outlet-anchor", displayName: "Duplex Outlet", transform, dimensions: { width: 0.08, height: 0.12, depth: 0.04, unit: "m" as const }, status: "active" as const, placedAt: "2026-01-01", updatedAt: "2026-01-01" };
    const anchors = [panel, outlet].map((object) => ({ id: object.anchorId, roomCaptureId: "room-1", reference: { surfaceId: "wall-1", kind: "wall" as const }, transform }));
    expect(validateProject(projectWith([panel, outlet], anchors), "2026-01-02").some((item) => item.ruleId === "minimum-clearance-check")).toBe(true);
  });

  it("gives each relationship validation issue a unique key", () => {
    const panel = { id: "panel", catalogObjectId: "electrical-panel-small", roomCaptureId: "room-1", anchorId: "panel-anchor", displayName: "Electrical Panel", transform, dimensions: { width: 0.4, height: 0.9, depth: 0.15, unit: "m" as const }, status: "active" as const, placedAt: "2026-01-01", updatedAt: "2026-01-01" };
    const outlet = (id: string) => ({ id, catalogObjectId: "electrical-outlet-duplex", roomCaptureId: "room-1", anchorId: `${id}-anchor`, displayName: "Duplex Outlet", transform, dimensions: { width: 0.08, height: 0.12, depth: 0.04, unit: "m" as const }, status: "active" as const, placedAt: "2026-01-01", updatedAt: "2026-01-01" as const });
    const outletOne = outlet("outlet-1");
    const outletTwo = outlet("outlet-2");
    const objects = [panel, outletOne, outletTwo];
    const anchors = objects.map((object) => ({ id: object.anchorId, roomCaptureId: "room-1", reference: { surfaceId: "wall-1", kind: "wall" as const }, transform }));
    const issues = validateProject(projectWith(objects, anchors), "2026-01-02");

    expect(new Set(issues.map((item) => item.id)).size).toBe(issues.length);
  });
});

describe("canonical placement validation", () => {
  const placed = (id: string, worldX: number, localX?: number, yaw = 0): Project["placedObjects"][number] => ({
    id, catalogObjectId: "furniture-sofa", roomCaptureId: "room-1", anchorId: `anchor-${id}`, displayName: id,
    transform: { ...transform, position: { x: worldX, y: 0, z: 0 } }, transformSpace: "ar-world", arSessionId: `session-${id}`,
    roomLocalTransform: localX === undefined ? undefined : { ...transform, position: { x: localX, y: 0, z: 0 }, rotation: { pitch: 0, yaw, roll: 0 } },
    dimensions: { width: 2, height: 1, depth: 0.2, unit: "m" }, status: "active", placedAt: "2026-10-01", updatedAt: "2026-10-01",
  });
  const collisions = (project: Project) => validateProject(project).filter(issue => issue.ruleId === "object-collision-check");
  it("detects overlapping room-local placements saved in different AR sessions", () => {
    const project = projectWith([placed("one", 0, 0), placed("two", 100, 0)], []);
    expect(collisions(project)).toHaveLength(1);
  });
  it("does not compare unrelated AR poses or report an unaligned object as checked", () => {
    const project = projectWith([placed("one", 0, 0), placed("two", 0)], []);
    expect(collisions(project)).toHaveLength(0);
    expect(validateProject(project)).toContainEqual(expect.objectContaining({ ruleId: "placement-frame-check", objectId: "two", severity: "warning" }));
  });
  it("does not report collisions between identical local coordinates in different rooms", () => {
    const project = projectWith([placed("one", 0, 0), { ...placed("two", 0, 0), roomCaptureId: "room-2" }], []);
    project.roomCaptures.push({ ...project.roomCaptures[0], id: "room-2" });
    expect(collisions(project)).toHaveLength(0);
  });
  it("uses room-local coordinates for clearance checks too", () => {
    const panel = { ...placed("panel", 0, 0), catalogObjectId: "electrical-panel-small" };
    const other = placed("other", 100, 0.2);
    expect(validateProject(projectWith([panel, other], []))).toContainEqual(expect.objectContaining({ ruleId: "minimum-clearance-check", objectId: "panel" }));
  });
  it("marks missing surface evidence unverified instead of claiming a wrong surface", () => {
    const project = projectWith([placed("one", 0, 0)], []);
    expect(validateProject(project).find(issue => issue.ruleId === "attach-to-supported-surface")).toMatchObject({ severity: "warning", message: expect.stringContaining("unverified") });
  });
  it("does not require a mounting surface for a free-place catalog item", () => {
    const project = projectWith([{ ...placed("pipe", 0, 0), catalogObjectId: "pipe-section-basic" }], []);
    expect(validateProject(project).filter(issue => issue.ruleId === "attach-to-supported-surface")).toHaveLength(0);
  });
});
