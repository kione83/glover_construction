import type { Project } from "./projects";
import type { Transform3D } from "./spatial";
import { canonicalTransform } from "./spatialTransforms";
import { moveAssemblyRoom, rotateAssemblyRoom } from "./roomAssembly";
import { validateProject } from "./validationService";

export type CatalogPlacementEdits = Record<string, Transform3D>;

/** Edit the canonical layout while preserving the original AR-session pose as capture evidence. */
export function moveCatalogPlacement(project: Project, edits: CatalogPlacementEdits, objectId: string, x: number, y: number, z: number, yaw = 0): CatalogPlacementEdits {
  const object = project.placedObjects.find(candidate => candidate.id === objectId && candidate.status === "active");
  if (!object?.roomLocalTransform || ![x, y, z, yaw].every(Number.isFinite)) return edits;
  const base = canonicalTransform(edits[objectId] ?? object.roomLocalTransform);
  const moved = moveAssemblyRoom(moveAssemblyRoom(moveAssemblyRoom(base, "x", x), "y", y), "z", z);
  return { ...edits, [objectId]: yaw ? rotateAssemblyRoom(moved, yaw, { x: 0, y: 0, z: 0 }) : moved };
}

export function catalogViewerTransforms(project: Project | undefined, edits: CatalogPlacementEdits) {
  const rooms: Record<string, Record<string, Transform3D>> = {};
  for (const object of project?.placedObjects ?? []) {
    if (object.status !== "active" || !object.roomLocalTransform || !edits[object.id]) continue;
    (rooms[object.roomCaptureId] ??= {})[`placed:${object.id}`] = edits[object.id];
  }
  return rooms;
}

export function applyCatalogPlacementEdits(project: Project, edits: CatalogPlacementEdits, updatedAt = new Date().toISOString()): Project {
  if (!Object.keys(edits).length) return { ...project, validationIssues: validateProject(project, updatedAt) };
  const next: Project = { ...project, placedObjects: project.placedObjects.map(object =>
    object.status === "active" && object.roomLocalTransform && edits[object.id] ? {
      ...object,
      roomLocalTransform: canonicalTransform(edits[object.id]),
      spatialStatus: "room-local",
      // A layout edit has no new physical-surface observation. Do not retain a false attachment claim.
      anchorId: `${object.id}-layout-unverified`,
      updatedAt,
    } : object,
  ) };
  return { ...next, validationIssues: validateProject(next, updatedAt) };
}
