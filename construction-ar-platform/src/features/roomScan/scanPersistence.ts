import { updateProjectSummary } from "../../storage/projectDocument";
import { addRoomToSpatialModel, type Project, type RoomCapture, type RoomScanData } from "../../domain/projects";
import { createScanMeasurementLogEntries } from "../../domain/scanMeasurementLog";
import { normalizeScanObjects } from "../../domain/scannedObjects";
import { loadProjectDocuments, saveProjectDocuments } from "../../storage/projectRepository";

export function toRoomCapture(project: Project, name: string, scan: RoomScanData, roomId: string): RoomCapture {
  const surfaces = scan.elements
    .filter((element) => ["wall", "floor", "ceiling", "opening"].includes(element.kind))
    .map((element) => ({
      id: `${roomId}-${element.id}`,
      kind: element.kind === "opening" ? "opening" : element.kind,
      label: `${name} ${element.category}`,
      dimensions: element.dimensions,
      centerPoint: element.transform.position,
      confidence: element.confidence,
    }))
    .filter((surface) => ["wall", "floor", "ceiling", "opening"].includes(surface.kind));

  const footprint = scan.floorFootprint;
  return {
    id: roomId,
    name: name.trim() || `Room ${project.roomCaptures.length + 1}`,
    status: "completed",
    source: "roomplan",
    unit: "m",
    measuredDimensions: footprint
      ? { width: footprint.width, height: scan.ceilingHeight ?? 0, depth: footprint.depth, unit: "m" }
      : undefined,
    bounds: footprint
      ? { center: { x: 0, y: (scan.ceilingHeight ?? 0) / 2, z: 0 }, size: footprint }
      : undefined,
    surfaces: surfaces as RoomCapture["surfaces"],
    notes: "RoomPlan scan. Individual transformed elements preserve irregular room geometry.",
    capturedAt: scan.capturedAt,
    roomScan: normalizeScanObjects(scan, roomId),
  };
}

/** Keep one room identity across retries and merge into the latest durable project. */
export async function persistCompletedScan(projectId: string, room: RoomCapture): Promise<Project> {
  const documents = await loadProjectDocuments();
  const document = documents.find(candidate => candidate.project.id === projectId);
  if (!document) throw new Error("The destination project could not be loaded. Keep this screen open and retry.");
  if (!room.roomScan) throw new Error("The completed scan is unavailable.");
  const project = document.project;
  const updatedProject = updateProjectSummary({
    ...addRoomToSpatialModel(project, room.id),
    status: "scanned",
    roomCaptures: [...project.roomCaptures.filter(candidate => candidate.id !== room.id), room],
  });
  await saveProjectDocuments(documents.map(candidate => candidate.project.id === projectId ? {
    ...candidate,
    project: updatedProject,
    scanMeasurementLogEntries: [
      ...(candidate.scanMeasurementLogEntries ?? []).filter(entry => entry.roomCaptureId !== room.id),
      ...createScanMeasurementLogEntries(projectId, room.id, room.roomScan!),
    ],
  } : candidate));
  return updatedProject;
}
