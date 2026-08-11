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
});
