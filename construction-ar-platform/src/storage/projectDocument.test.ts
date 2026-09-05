import { describe, expect, it } from "vitest";

import { createEmptyProjectDocument, hydrateProjectDocument, summarizeProjectScans, summarizeRoomScan } from "./projectDocument";
import { clearRoomPlacementsFromProject } from "../domain/projects";

describe("projectDocument", () => {
  it("creates empty project documents with an empty measurement log", () => {
    const document = createEmptyProjectDocument({
      id: "project-1",
      name: "Kitchen Remodel",
    });

    expect(document.schemaVersion).toBe(6);
    expect(document.measurementLogEntries).toEqual([]);
    expect(document.scanMeasurementLogEntries).toEqual([]);
    expect(document.project.photos).toEqual([]);
    expect(document.project.fieldNotes).toEqual([]);
    expect(document.project.blueprints).toEqual([]);
  });

  it("hydrates older saved documents that do not yet contain measurement logs", () => {
    const hydrated = hydrateProjectDocument({
      kind: "construction-ar-project",
      schemaVersion: 1,
      project: createEmptyProjectDocument({
        id: "project-1",
        name: "Kitchen Remodel",
      }).project,
    });

    expect(hydrated).not.toBeNull();
    expect(hydrated?.schemaVersion).toBe(6);
    expect(hydrated?.measurementLogEntries).toEqual([]);
    expect(hydrated?.scanMeasurementLogEntries).toEqual([]);
    expect(hydrated?.project.photos).toEqual([]);
    expect(hydrated?.project.fieldNotes).toEqual([]);
    expect(hydrated?.project.blueprints).toEqual([]);
  });

  it("clears only virtual placements and their anchors for the selected room", () => {
    const room = {
      id: "room-1",
      name: "Kitchen",
      status: "completed" as const,
      source: "manual" as const,
      unit: "m" as const,
      surfaces: [{ id: "floor-1", kind: "floor" as const, label: "Kitchen floor" }],
    };
    const project = createEmptyProjectDocument({
      id: "project-1",
      name: "Kitchen Remodel",
      roomCaptures: [room, { ...room, id: "room-2", name: "Bath" }],
      anchors: [
        {
          id: "anchor-1",
          roomCaptureId: "room-1",
          reference: { surfaceId: "floor-1", kind: "floor" },
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 }, scale: { x: 1, y: 1, z: 1 } },
        },
      ],
      placedObjects: [
        {
          id: "object-1",
          catalogObjectId: "furniture-sofa",
          roomCaptureId: "room-1",
          anchorId: "anchor-1",
          displayName: "Sofa",
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 }, scale: { x: 1, y: 1, z: 1 } },
          dimensions: { width: 2, height: 1, depth: 1, unit: "m" },
          status: "active",
          placedAt: "2026-01-01",
          updatedAt: "2026-01-01",
        },
      ],
    }).project;

    const cleared = clearRoomPlacementsFromProject(project, "room-1");

    expect(cleared.roomCaptures).toHaveLength(2);
    expect(cleared.placedObjects).toEqual([]);
    expect(cleared.anchors).toEqual([]);
  });

  it("keeps scan geometry metadata while removing heavy native archive payloads from the project index", () => {
    const scan = {
      version: 1 as const,
      source: "roomplan" as const,
      capturedAt: "2026-01-01T00:00:00.000Z",
      elements: [],
      nativeCapturedRoomJSON: "large-native-archive",
      arkitMesh: { format: "arkit-mesh-v1" as const, capturedAt: "2026-01-01T00:00:00.000Z", anchors: [] },
      archiveUri: "file:///Documents/construction-ar-platform/scans/room.json",
      portal: { format: "construction-ar-room-scan" as const, version: 1 as const },
    };
    const summary = summarizeRoomScan(scan);
    expect(summary.nativeCapturedRoomJSON).toBeUndefined();
    expect(summary.arkitMesh).toBeUndefined();
    expect(summary.archiveUri).toContain("room.json");
    expect(summarizeProjectScans({
      ...createEmptyProjectDocument({ id: "project-1", name: "Test" }).project,
      roomCaptures: [{ id: "room-1", name: "Room", status: "completed", source: "roomplan", unit: "m", surfaces: [], roomScan: scan }],
    }).roomCaptures[0].roomScan?.nativeCapturedRoomJSON).toBeUndefined();
  });
});
