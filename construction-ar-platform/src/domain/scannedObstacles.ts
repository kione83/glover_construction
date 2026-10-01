import type { Project, RoomCapture } from "./projects";
import { placementBox } from "./placementGeometry";
import { assemblyRootPose, capturedObjectPose, scannedObjectRoots } from "./scannedObjectAssemblies";
import { composeTransforms, relativeTransform } from "./spatialTransforms";

/** Same canonical assembly poses as the saved viewer, in the owning room frame. */
export function scannedObstacleBoxes(project: Project, room: RoomCapture) {
  const scan = room.roomScan;
  if (!scan) return [];
  const roots = scannedObjectRoots(scan);
  const overrides = project.spatialModel?.objectTransforms?.[room.id] ?? {};
  const elements = new Map(scan.elements.map(element => [element.id, element]));
  return scan.elements.flatMap(element => {
    // Architectural support faces/openings are not solid furniture obstacles.
    if (!["furniture", "fixture", "built-in"].includes(element.kind)) return [];
    const rootId = roots.get(element.id) ?? element.id;
    const root = elements.get(rootId);
    if (!root) return [];
    const rootPose = assemblyRootPose(scan, rootId, overrides);
    const relative = relativeTransform(capturedObjectPose(root), capturedObjectPose(element));
    if (!relative) return [];
    const pose = composeTransforms(rootPose, relative);
    const box = placementBox(pose, element.dimensions);
    return box ? [{ id: element.id, label: element.category.replace(/[-_]/g, " "), box }] : [];
  });
}
