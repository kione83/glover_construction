import type { Project } from "./projects";
import type { Transform3D } from "./spatial";
import { assemblyRootPose, scannedObjectRoots } from "./scannedObjectAssemblies";
import { moveAssemblyRoom, rotateAssemblyRoom } from "./roomAssembly";

export type ObjectPlacements = Record<string, Record<string, Transform3D>>;
export function editableScanObject(project: Project | undefined, roomId?: string, featureId?: string) {
  if (!roomId || !featureId) return undefined;
  const scan = project?.roomCaptures.find(r => r.id === roomId)?.roomScan;
  const rootId = scan && scannedObjectRoots(scan).get(featureId);
  return scan?.elements.find(element => element.id === rootId);
}
/** Saved-viewer only. X/Z are room-local; Y is deliberately preserved. */
export function moveScanObject(project: Project, placements: ObjectPlacements, roomId: string, featureId: string, x: number, z: number, yaw = 0, capturing = false): ObjectPlacements {
  const object = editableScanObject(project, roomId, featureId);
  if (capturing || !object || ![x, z, yaw].every(Number.isFinite)) return placements;
  const scan = project.roomCaptures.find(room => room.id === roomId)!.roomScan!;
  const base = assemblyRootPose(scan, object.id, placements[roomId] ?? {});
  const moved = moveAssemblyRoom(moveAssemblyRoom(base, "x", x), "z", z);
  const next = yaw ? rotateAssemblyRoom(moved, yaw, { x: 0, y: 0, z: 0 }) : moved;
  const roots = scannedObjectRoots(scan);
  const roomPlacements = Object.fromEntries(Object.entries(placements[roomId] ?? {}).filter(([id]) => roots.get(id) !== object.id));
  return { ...placements, [roomId]: { ...roomPlacements, [object.id]: next } };
}

/** Bridge only root poses; legacy component overrides must never move child nodes twice. */
export function viewerObjectTransforms(project: Project | undefined, placements: ObjectPlacements): ObjectPlacements {
  return Object.fromEntries((project?.roomCaptures ?? []).filter(room => room.roomScan).map(room => {
    const scan = room.roomScan!;
    const roots = scannedObjectRoots(scan);
    const editedRoots = new Set(Object.keys(placements[room.id] ?? {}).map(id => roots.get(id)).filter((id): id is string => !!id));
    return [room.id, Object.fromEntries([...editedRoots].map(id => [id, assemblyRootPose(scan, id, placements[room.id] ?? {})]))];
  }));
}
