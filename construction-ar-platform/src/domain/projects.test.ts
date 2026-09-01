import { describe, expect, it } from "vitest";

import { createEmptyProjectDocument } from "../storage/projectDocument";
import {
  connectRoomsInProject,
  relativeYawTransform,
  removePlacedObjectFromProject,
  removeRoomFromProject,
  type Project,
} from "./projects";

const transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { pitch: 0, yaw: 0, roll: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function projectWithRooms(): Project {
  return createEmptyProjectDocument({
    id: "project-1",
    name: "Test project",
    roomCaptures: [
      { id: "room-a", name: "A", status: "completed", source: "manual", unit: "m", surfaces: [{ id: "surface-a", kind: "wall", label: "A wall" }] },
      { id: "room-b", name: "B", status: "completed", source: "manual", unit: "m", surfaces: [{ id: "surface-b", kind: "wall", label: "B wall" }] },
    ],
    anchors: [
      { id: "anchor-a", roomCaptureId: "room-a", reference: { surfaceId: "surface-a", kind: "wall" }, transform },
      { id: "anchor-b", roomCaptureId: "room-b", reference: { surfaceId: "surface-b", kind: "wall" }, transform },
    ],
    placedObjects: [
      { id: "object-a", catalogObjectId: "furniture-sofa", roomCaptureId: "room-a", anchorId: "anchor-a", displayName: "Sofa", transform, dimensions: { width: 2, height: 1, depth: 1, unit: "m" }, status: "active", placedAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "object-b", catalogObjectId: "furniture-sofa", roomCaptureId: "room-b", anchorId: "anchor-b", displayName: "Sofa", transform, dimensions: { width: 2, height: 1, depth: 1, unit: "m" }, status: "active", placedAt: "2026-01-01", updatedAt: "2026-01-01" },
    ],
    spatialModel: {
      coordinateSystem: "project-local",
      roomTransforms: { "room-a": transform, "room-b": transform },
      connections: [],
    },
    validationIssues: [
      { id: "issue-a", ruleId: "collision", severity: "error", message: "A", objectId: "object-a", detectedAt: "2026-01-01" },
      { id: "issue-b", ruleId: "collision", severity: "error", message: "B", objectId: "object-b", detectedAt: "2026-01-01" },
    ],
  }).project;
}

describe("project spatial and deletion helpers", () => {
  it("round-trips project transforms through a parent-relative connection without losing elevation", () => {
    const parent = { ...transform, position: { x: 4, y: 1, z: -2 }, rotation: { ...transform.rotation, yaw: Math.PI / 2 } };
    const child = { ...transform, position: { x: 5, y: 3.5, z: 1 }, rotation: { ...transform.rotation, yaw: Math.PI } };
    const relative = relativeYawTransform(parent, child);
    expect(relative.position.y).toBeCloseTo(2.5);
    const roundTripped = relativeYawTransformsBack(parent, relative).position;
    expect(roundTripped.x).toBeCloseTo(5);
    expect(roundTripped.y).toBeCloseTo(3.5);
    expect(roundTripped.z).toBeCloseTo(1);
  });

  it("composes a connected room transform in 3D, including elevation", () => {
    const project = projectWithRooms();
    const connected = connectRoomsInProject({
      ...project,
      spatialModel: {
        ...project.spatialModel!,
        roomTransforms: {
          ...project.spatialModel!.roomTransforms,
          "room-a": { ...transform, position: { x: 2, y: 1, z: 3 }, rotation: { ...transform.rotation, yaw: Math.PI / 2 } },
        },
      },
    }, {
      id: "connection-a-b",
      parentRoomId: "room-a",
      childRoomId: "room-b",
      connectionType: "stairs",
      transform: { ...transform, position: { x: 1, y: 2, z: 0 }, rotation: { ...transform.rotation, yaw: Math.PI / 2 } },
      alignmentMethod: "user-assisted",
      elevationChangeMeters: 2,
    });

    expect(connected.spatialModel?.roomTransforms["room-b"]?.position).toEqual({ x: 2, y: 3, z: 4 });
    expect(connected.spatialModel?.connections[0]).toMatchObject({ connectionType: "stairs", elevationChangeMeters: 2 });
  });

  it("removes one room's objects, anchors, issues, transform, and connections while preserving other rooms", () => {
    const project = projectWithRooms();
    const connected = connectRoomsInProject(project, {
      id: "connection-a-b",
      parentRoomId: "room-a",
      childRoomId: "room-b",
      connectionType: "doorway",
      transform,
      alignmentMethod: "user-assisted",
      elevationChangeMeters: 0,
    });
    const cleaned = removeRoomFromProject(connected, "room-a");

    expect(cleaned.roomCaptures.map((room) => room.id)).toEqual(["room-b"]);
    expect(cleaned.placedObjects.map((object) => object.id)).toEqual(["object-b"]);
    expect(cleaned.anchors.map((anchor) => anchor.id)).toEqual(["anchor-b"]);
    expect(cleaned.validationIssues.map((issue) => issue.id)).toEqual(["issue-b"]);
    expect(cleaned.spatialModel?.roomTransforms).toEqual({ "room-b": transform });
    expect(cleaned.spatialModel?.connections).toEqual([]);
  });

  it("cleans validation issues when one placed object is removed", () => {
    const cleaned = removePlacedObjectFromProject(projectWithRooms(), "object-a");
    expect(cleaned.placedObjects.map((object) => object.id)).toEqual(["object-b"]);
    expect(cleaned.anchors.map((anchor) => anchor.id)).toEqual(["anchor-b"]);
    expect(cleaned.validationIssues.map((issue) => issue.id)).toEqual(["issue-b"]);
  });
});

function relativeYawTransformsBack(parent: typeof transform, relative: typeof transform) {
  const yaw = parent.rotation.yaw;
  return {
    position: {
      x: parent.position.x + relative.position.x * Math.cos(yaw) - relative.position.z * Math.sin(yaw),
      y: parent.position.y + relative.position.y,
      z: parent.position.z + relative.position.x * Math.sin(yaw) + relative.position.z * Math.cos(yaw),
    },
  };
}
