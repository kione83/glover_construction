import type { PlacedObject, Project } from "./projects";
import type { Transform3D } from "./spatial";
import { canonicalTransform, composeTransforms, relativeTransform, validMatrix, inverseTransform } from "./spatialTransforms";
import { starterCatalog } from "./catalog";

/** Observed plane frame in the current AR session; +Z points away from the support. */
export interface PlacementSurfaceObservation {
  id: string;
  kind: "wall" | "floor" | "ceiling";
  transformMatrix: number[];
  observedAt: string;
}

export function savePlacementSurface(project: Project, object: PlacedObject, observation?: PlacementSurfaceObservation, worldFromRoom?: Transform3D): Project {
  const catalog = starterCatalog.find(item => item.id === object.catalogObjectId);
  const local = observation && worldFromRoom && validMatrix(observation.transformMatrix) && inverseTransform({ ...canonicalTransform(), matrix: observation.transformMatrix })
    ? relativeTransform(worldFromRoom, canonicalTransform({ matrix: observation.transformMatrix })) : null;
  const valid = !!(local && observation?.id && object.roomLocalTransform && catalog?.allowedSurfaceKinds.includes(observation.kind)
    && Number.isFinite(Date.parse(observation.observedAt)));
  // Each placement owns its evidence. A move without a fresh/rehydrated observation
  // must not reuse an earlier attachment claim.
  const anchorId = `${object.id}-surface-anchor`;
  const surfaceId = `${object.id}-observed-surface`;
  const roomCaptures = project.roomCaptures.map(room => room.id === object.roomCaptureId ? {
    ...room,
    surfaces: [...room.surfaces.filter(surface => surface.id !== surfaceId), ...(valid ? [{
      id: surfaceId, kind: observation!.kind, label: `Observed ${observation!.kind} for ${object.displayName}`,
      centerPoint: local!.position,
    }] : [])],
  } : room);
  const anchors = project.anchors.filter(anchor => anchor.id !== anchorId && (anchor.id !== object.anchorId || project.placedObjects.some(other => other.id !== object.id && other.anchorId === anchor.id)));
  if (valid) anchors.push({ id: anchorId, roomCaptureId: object.roomCaptureId,
    reference: { surfaceId, kind: observation!.kind }, transform: local!,
    observation: { source: "ar-plane", nativePlaneId: observation!.id, observedAt: observation!.observedAt },
  });
  const updatedObject = { ...object, anchorId: valid ? anchorId : `${object.id}-surface-unverified` };
  return { ...project, roomCaptures, anchors, placedObjects: project.placedObjects.some(item => item.id === object.id)
    ? project.placedObjects.map(item => item.id === object.id ? updatedObject : item)
    : [...project.placedObjects, updatedObject] };
}

/** Reproject saved support evidence with the room when reopening a fresh AR session. */
export function placementSurfaceForAR(project: Project, object: PlacedObject, worldFromRoom: Transform3D): PlacementSurfaceObservation | undefined {
  const anchor = project.anchors.find(item => item.id === object.anchorId && item.roomCaptureId === object.roomCaptureId);
  if (!anchor?.observation || !["wall", "floor", "ceiling"].includes(anchor.reference.kind)) return undefined;
  return { id: anchor.observation.nativePlaneId, kind: anchor.reference.kind as PlacementSurfaceObservation["kind"],
    transformMatrix: composeTransforms(worldFromRoom, anchor.transform).matrix!, observedAt: anchor.observation.observedAt };
}
