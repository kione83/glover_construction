import type { PlacedObject, Project, RoomCapture, Transform3D } from "./index";
import { starterCatalog } from "./catalog";
import { deriveObjectMeasurements, normalizeRoomObjects } from "./scannedObjects";
import { canonicalTransform, relativeTransform, validMatrix } from "./spatialTransforms";

export function normalizePlacedObject(object: PlacedObject, project: Project): PlacedObject {
  const room = project.roomCaptures.find(candidate => candidate.id === object.roomCaptureId);
  let local: Transform3D | undefined;
  if (object.roomLocalTransform) local = canonicalTransform(object.roomLocalTransform);
  else if (object.transformSpace === "room-local") local = canonicalTransform(object.transform);
  else if (object.transformSpace === "ar-world" && object.arWorldFromRoom) local = relativeTransform(object.arWorldFromRoom, canonicalTransform(object.transform)) ?? undefined;
  else if (object.transformSpace === "project-local") local = relativeTransform(canonicalTransform(project.spatialModel?.roomTransforms?.[object.roomCaptureId]), canonicalTransform(object.transform)) ?? undefined;
  else if (!object.transformSpace && room && project.anchors?.some(anchor => anchor.id === object.anchorId && anchor.roomCaptureId === room.id && room.surfaces?.some(surface => surface.id === anchor.reference?.surfaceId))) {
    // Legacy manual catalog placement authored in the room, with a real saved surface anchor.
    // Legacy AR placements only fabricated an anchorId and have no such record.
    local = canonicalTransform(object.transform);
  }
  return { ...object,
    objectTypeId: object.objectTypeId ?? `catalog:${object.catalogObjectId}`,
    objectMeasurements: object.objectMeasurements ?? deriveObjectMeasurements(object.dimensions, starterCatalog.some(item => item.id === object.catalogObjectId) ? 1 : undefined),
    roomLocalTransform: local,
    spatialStatus: room && local ? "room-local" : "needs-alignment",
  };
}

/** Additive migration. Never reinterpret unknown AR coordinates as captured-room coordinates. */
export function normalizeProjectHierarchy(project: Project): Project {
  const rooms = (project.roomCaptures ?? []).map(normalizeRoomObjects);
  const spatial = project.spatialModel;
  const normalized: Project = { ...project, roomCaptures: rooms, anchors: project.anchors ?? [],
    spatialModel: { ...spatial, coordinateSystem: "project-local", roomTransforms: Object.fromEntries(
      Object.entries(spatial?.roomTransforms ?? {}).map(([id, transform]) => [id, canonicalTransform(transform)])),
      connections: spatial?.connections ?? [], lockedRoomId: rooms.some(room => room.id === spatial?.lockedRoomId) ? spatial?.lockedRoomId : undefined,
    },
  };
  return { ...normalized, placedObjects: (project.placedObjects ?? []).map(object => normalizePlacedObject(object, normalized)) };
}

/** Preserve AR source pose as evidence and derive the canonical local pose once at edit time. */
export function placeObjectInRoom(object: PlacedObject, worldPose: Transform3D, sessionId: string, worldFromRoom?: Transform3D): PlacedObject {
  const local = worldFromRoom ? relativeTransform(worldFromRoom, worldPose) : null;
  return { ...object, transform: canonicalTransform(worldPose), transformSpace: "ar-world", arSessionId: sessionId,
    arWorldFromRoom: worldFromRoom, roomLocalTransform: local ?? undefined, spatialStatus: local ? "room-local" : "needs-alignment" };
}

/** Catalog placements are an additional set of children; never inject them into captured archives. */
export function savedPlacementElements(project: Project, room: RoomCapture) {
  return project.placedObjects.filter(object => object.status === "active" && object.roomCaptureId === room.id && object.roomLocalTransform).map(object => {
    const catalog = starterCatalog.find(item => item.id === object.catalogObjectId);
    return { id: `placed:${object.id}`, instanceId: object.id, roomCaptureId: room.id, objectTypeId: object.objectTypeId,
      kind: "furniture", category: object.displayName, representation: object.representation ?? catalog?.representation ?? "generic-object",
      dimensions: object.dimensions, transform: canonicalTransform(object.roomLocalTransform), roomLocalTransform: canonicalTransform(object.roomLocalTransform),
      objectMeasurements: object.objectMeasurements,
    };
  });
}

export function hasRoomLocalPlacement(object: PlacedObject): boolean {
  return !!object.roomLocalTransform && validMatrix(canonicalTransform(object.roomLocalTransform).matrix);
}
