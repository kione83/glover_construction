import type { RoomScanData, RoomScanElement } from "./projects";
import type { Transform3D } from "./spatial";
import { canonicalTransform, capturedTransform, composeTransforms, inverseTransform, relativeTransform } from "./spatialTransforms";

const editable = (element: RoomScanElement) => ["furniture", "fixture", "built-in"].includes(element.kind);
export const capturedObjectPose = (element: RoomScanElement) => element.roomLocalTransform ? canonicalTransform(element.roomLocalTransform) : capturedTransform(element.transform);

/** Only explicit RoomPlan ownership is evidence of an assembly. Type/size/proximity are not. */
export function scannedObjectParents(scan: RoomScanData): Map<string, string> {
  const objects = new Map(scan.elements.filter(editable).map(element => [element.id, element]));
  const identifiers = new Map([...objects.keys()].map(id => [id.toLowerCase(), id]));
  const rawParents = new Map<string, string>();
  try {
    const archive: unknown = scan.nativeCapturedRoomJSON ? JSON.parse(scan.nativeCapturedRoomJSON) : undefined;
    const entries = (archive as { objects?: unknown[] } | undefined)?.objects;
    if (Array.isArray(entries)) for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const { identifier, parentIdentifier } = entry as Record<string, unknown>;
      if (typeof identifier === "string" && typeof parentIdentifier === "string") rawParents.set(identifier.toLowerCase(), parentIdentifier);
    }
  } catch { /* Old scans without a readable native archive remain independent objects. */ }
  const candidates = new Map<string, string>();
  for (const element of objects.values()) {
    const parentId = element.parentObjectId ?? rawParents.get(element.id.toLowerCase());
    const parent = typeof parentId === "string" ? identifiers.get(parentId.toLowerCase()) : undefined;
    if (parent && parent !== element.id && inverseTransform(capturedObjectPose(objects.get(parent)!))) candidates.set(element.id, parent);
  }
  // Reject cyclic chains entirely, including links into them. Never silently drop geometry.
  return new Map([...candidates].filter(([id]) => {
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current) { if (seen.has(current)) return false; seen.add(current); current = candidates.get(current); }
    return true;
  }));
}

const cache = new WeakMap<RoomScanData, Map<string, string>>();
/** Immutable loaded scan data gives every component one stable transform owner. */
export function scannedObjectRoots(scan: RoomScanData): Map<string, string> {
  const cached = cache.get(scan); if (cached) return cached;
  const parents = scannedObjectParents(scan), roots = new Map<string, string>();
  for (const element of scan.elements.filter(editable)) {
    let root = element.id;
    while (parents.has(root)) root = parents.get(root)!;
    roots.set(element.id, root);
  }
  cache.set(scan, roots); return roots;
}

export function assemblyRootPose(scan: RoomScanData, rootId: string, overrides: Record<string, Transform3D>): Transform3D {
  const root = scan.elements.find(element => element.id === rootId)!;
  const captured = capturedObjectPose(root);
  if (overrides[rootId]) return canonicalTransform(overrides[rootId]);
  // Legacy edits addressed components independently. Adopt a deterministic edited
  // component's rigid delta when the root has no edit; a root edit always wins.
  const roots = scannedObjectRoots(scan);
  for (const id of Object.keys(overrides).sort()) {
    if (roots.get(id) !== rootId) continue;
    const element = scan.elements.find(candidate => candidate.id === id)!;
    const local = relativeTransform(captured, capturedObjectPose(element));
    const inverse = local && inverseTransform(local);
    if (inverse) return composeTransforms(overrides[element.id], inverse);
  }
  return captured;
}
