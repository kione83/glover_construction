import type {
  BoundingBox3D,
  Dimensions3D,
  LengthUnit,
  RotationEuler,
  SurfaceKind,
  SurfaceReference,
  Transform3D,
  Vec3,
} from "./spatial";

export type ProjectStatus = "draft" | "scanned" | "layout-in-progress" | "validated" | "archived";

export type CaptureStatus = "not-started" | "in-progress" | "completed" | "failed";

export type ObjectCategory =
  | "electrical"
  | "hvac"
  | "low-voltage"
  | "life-safety"
  | "plumbing"
  | "architectural"
  | "furniture"
  | "general";

export type PlacementMode = "wall-mounted" | "floor-mounted" | "ceiling-mounted" | "free-place";

export type ValidationSeverity = "info" | "warning" | "error";

export type ValidationRuleType =
  | "attachment"
  | "collision"
  | "clearance"
  | "boundary"
  | "metadata";

export interface ProjectTimestamps {
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

export interface Surface {
  id: string;
  kind: SurfaceKind;
  label: string;
  dimensions?: Dimensions3D;
  centerPoint?: Vec3;
  bounds?: BoundingBox3D;
  confidence?: number;
}

export type RoomScanSource = "roomplan" | "unsupported" | "fallback";

export type RoomScanElementKind =
  | "wall"
  | "floor"
  | "ceiling"
  | "door"
  | "window"
  | "opening"
  | "built-in"
  | "furniture"
  | "fixture";

export type RoomScanRepresentation =
  | "wall"
  | "floor"
  | "door"
  | "window"
  | "opening"
  | "sofa"
  | "chair"
  | "table"
  | "bed"
  | "cabinet"
  | "fireplace"
  | "television"
  | "appliance"
  | "plumbing-fixture"
  | "stairs"
  | "generic-object";

export interface RoomScanTransform {
  position: Vec3;
  rotation: RotationEuler;
  scale: Vec3;
}

export interface RoomScanElement {
  id: string;
  wallId?: string;
  kind: RoomScanElementKind;
  category: string;
  representation: RoomScanRepresentation;
  dimensions: Dimensions3D;
  transform: RoomScanTransform;
  confidence?: number;
  polygonCorners?: Vec3[];
}

export type RoomScanMeasurementDimension = "width" | "height" | "depth";

export interface RoomScanMeasurementHistoryEntry {
  timestamp: string;
  value: number;
  rawValue?: number;
  confidence?: number;
  confidenceSource?: "native" | "derived";
  quality?: "estimating" | "stable" | "limited";
  valueSource?: "roomplan" | "floor-ceiling" | "arkit-mesh";
  observationCount: number;
}

export interface RoomScanMeasurement {
  id: string;
  elementId: string;
  wallId?: string;
  category: string;
  dimension: RoomScanMeasurementDimension;
  label: string;
  value: number;
  unit: "m";
  status: "estimated" | "estimating" | "stable" | "limited";
  initialEstimate: number;
  updatedAt: string;
  updateCount: number;
  observationCount: number;
  confidence?: number;
  confidenceSource?: "native" | "derived";
  source: "roomplan" | "arkit" | "derived";
  quality?: "estimating" | "stable" | "limited";
  rawValue?: number;
  valueSource?: "roomplan" | "floor-ceiling" | "arkit-mesh";
  history: RoomScanMeasurementHistoryEntry[];
}

export interface RoomScanMeshAnchor {
  id: string;
  transform: Transform3D;
  vertices: Vec3[];
  indices: number[];
  classification?: string;
  bounds?: { min: Vec3; max: Vec3 };
  floorElevation?: number;
  ceilingElevation?: number;
}

export interface RoomScanMeshData {
  format: "arkit-mesh-v1";
  capturedAt: string;
  anchors: RoomScanMeshAnchor[];
  limitation?: string;
}

export interface RoomScanData {
  version: 1;
  source: RoomScanSource;
  capturedAt: string;
  nativeIdentifier?: string;
  floorFootprint?: Dimensions3D;
  ceilingHeight?: number;
  elements: RoomScanElement[];
  measurements?: RoomScanMeasurement[];
  /** JSON-encoded Codable CapturedRoom retained for native re-opening/export. */
  nativeCapturedRoomJSON?: string;
  /** Bounded ARKit scene-reconstruction mesh for irregular architecture such as stairs. */
  arkitMesh?: RoomScanMeshData;
  portal: {
    format: "construction-ar-room-scan";
    version: 1;
  };
  limitation?: string;
}

export type RoomConnectionType = "door" | "doorway" | "shared-wall" | "corner" | "opening" | "hallway" | "stairs" | "other";

export interface RoomConnection {
  id: string;
  parentRoomId: string;
  childRoomId: string;
  connectionType: RoomConnectionType;
  parentFeatureId?: string;
  childFeatureId?: string;
  transform: Transform3D;
  alignmentMethod: "user-assisted" | "world-map";
  elevationChangeMeters: number;
  createdAt: string;
}

export interface ProjectSpatialModel {
  coordinateSystem: "project-local";
  roomTransforms: Record<string, Transform3D>;
  connections: RoomConnection[];
}

export interface RoomCapture {
  id: string;
  name: string;
  status: CaptureStatus;
  source: "roomplan" | "arkit" | "manual" | "unknown";
  unit: LengthUnit;
  bounds?: BoundingBox3D;
  measuredDimensions?: Dimensions3D;
  surfaces: Surface[];
  notes?: string;
  capturedAt?: string;
  roomScan?: RoomScanData;
}

export interface CatalogObject {
  id: string;
  sku: string;
  name: string;
  category: ObjectCategory;
  placementMode: PlacementMode;
  defaultDimensions: Dimensions3D;
  defaultClearance?: Dimensions3D;
  allowedSurfaceKinds: SurfaceKind[];
  tags: string[];
  description?: string;
  representation?: RoomScanRepresentation;
}

export interface PlacementAnchor {
  id: string;
  roomCaptureId: string;
  reference: SurfaceReference;
  transform: Transform3D;
}

export interface PlacedObject {
  id: string;
  catalogObjectId: string;
  roomCaptureId: string;
  anchorId: string;
  displayName: string;
  transform: Transform3D;
  dimensions: Dimensions3D;
  status: "active" | "deleted";
  placedAt: string;
  updatedAt: string;
  metadata?: Record<string, string | number | boolean>;
  representation?: RoomScanRepresentation;
}

export interface ValidationRule {
  id: string;
  type: ValidationRuleType;
  name: string;
  description: string;
  severity: ValidationSeverity;
  appliesToCategories: ObjectCategory[];
}

export interface ValidationIssue {
  id: string;
  ruleId: string;
  severity: ValidationSeverity;
  message: string;
  objectId?: string;
  surfaceId?: string;
  detectedAt: string;
}

export interface ProjectSummary {
  roomCount: number;
  placedObjectCount: number;
  validationIssueCount: number;
  lastValidatedAt?: string;
}

export interface ProjectPhoto {
  id: string;
  uri: string;
  capturedAt: string;
  caption?: string;
}

export interface ProjectFieldNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  clientName?: string;
  siteName?: string;
  address?: string;
  status: ProjectStatus;
  targetDevice: "iphone" | "ipad" | "vision-pro" | "unknown";
  timestamps: ProjectTimestamps;
  roomCaptures: RoomCapture[];
  anchors: PlacementAnchor[];
  placedObjects: PlacedObject[];
  photos: ProjectPhoto[];
  fieldNotes: ProjectFieldNote[];
  spatialModel?: ProjectSpatialModel;
  validationIssues: ValidationIssue[];
  summary: ProjectSummary;
}

/** Remove one virtual placement and only the anchor created for that placement. */
export function removePlacedObjectFromProject(project: Project, objectId: string): Project {
  const object = project.placedObjects.find((candidate) => candidate.id === objectId);

  return {
    ...project,
    placedObjects: project.placedObjects.filter((candidate) => candidate.id !== objectId),
    anchors: object
      ? project.anchors.filter((anchor) => anchor.id !== object.anchorId)
      : project.anchors,
    validationIssues: project.validationIssues.filter((issue) => issue.objectId !== objectId),
  };
}

/** Clear virtual placements for one room without changing measurements or room data. */
export function clearRoomPlacementsFromProject(project: Project, roomCaptureId: string): Project {
  const roomObjectIds = new Set(
    project.placedObjects
      .filter((object) => object.roomCaptureId === roomCaptureId)
      .map((object) => object.id),
  );
  const roomAnchorIds = new Set(
    project.placedObjects
      .filter((object) => roomObjectIds.has(object.id))
      .map((object) => object.anchorId),
  );

  return {
    ...project,
    placedObjects: project.placedObjects.filter(
      (object) => object.roomCaptureId !== roomCaptureId,
    ),
    anchors: project.anchors.filter((anchor) => !roomAnchorIds.has(anchor.id)),
    validationIssues: project.validationIssues.filter(
      (issue) => !issue.objectId || !roomObjectIds.has(issue.objectId),
    ),
  };
}

export function identityTransform(): Transform3D {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { pitch: 0, yaw: 0, roll: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export function composeYawTransforms(parent: Transform3D, relative: Transform3D): Transform3D {
  const yaw = parent.rotation.yaw;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    position: {
      x: parent.position.x + relative.position.x * cos - relative.position.z * sin,
      y: parent.position.y + relative.position.y,
      z: parent.position.z + relative.position.x * sin + relative.position.z * cos,
    },
    rotation: {
      pitch: parent.rotation.pitch + relative.rotation.pitch,
      yaw: parent.rotation.yaw + relative.rotation.yaw,
      roll: parent.rotation.roll + relative.rotation.roll,
    },
    scale: { x: parent.scale.x * relative.scale.x, y: parent.scale.y * relative.scale.y, z: parent.scale.z * relative.scale.z },
  };
}

/** Convert a project-space child transform to a transform relative to its parent. */
export function relativeYawTransform(parent: Transform3D, child: Transform3D): Transform3D {
  const deltaX = child.position.x - parent.position.x;
  const deltaZ = child.position.z - parent.position.z;
  const inverseYaw = -parent.rotation.yaw;
  const cos = Math.cos(inverseYaw);
  const sin = Math.sin(inverseYaw);
  return {
    position: {
      x: deltaX * cos - deltaZ * sin,
      y: child.position.y - parent.position.y,
      z: deltaX * sin + deltaZ * cos,
    },
    rotation: {
      pitch: child.rotation.pitch - parent.rotation.pitch,
      yaw: child.rotation.yaw - parent.rotation.yaw,
      roll: child.rotation.roll - parent.rotation.roll,
    },
    scale: {
      x: parent.scale.x === 0 ? child.scale.x : child.scale.x / parent.scale.x,
      y: parent.scale.y === 0 ? child.scale.y : child.scale.y / parent.scale.y,
      z: parent.scale.z === 0 ? child.scale.z : child.scale.z / parent.scale.z,
    },
  };
}

export function setRoomProjectTransform(project: Project, roomId: string, transform: Transform3D): Project {
  return {
    ...project,
    spatialModel: {
      coordinateSystem: "project-local",
      roomTransforms: {
        ...(project.spatialModel?.roomTransforms ?? {}),
        [roomId]: transform,
      },
      connections: project.spatialModel?.connections ?? [],
    },
  };
}

export function disconnectRoomFromProject(project: Project, roomId: string): Project {
  return {
    ...project,
    spatialModel: project.spatialModel
      ? {
          ...project.spatialModel,
          connections: project.spatialModel.connections.filter(
            (connection) => connection.parentRoomId !== roomId && connection.childRoomId !== roomId,
          ),
        }
      : project.spatialModel,
  };
}

export function connectRoomsInProject(
  project: Project,
  connection: Omit<RoomConnection, "createdAt"> & { createdAt?: string },
): Project {
  const parentTransform = project.spatialModel?.roomTransforms[connection.parentRoomId] ?? identityTransform();
  const childTransform = composeYawTransforms(parentTransform, connection.transform);
  const spatialModel: ProjectSpatialModel = {
    coordinateSystem: "project-local",
    roomTransforms: {
      ...(project.spatialModel?.roomTransforms ?? {}),
      [connection.childRoomId]: childTransform,
    },
    connections: [
      ...(project.spatialModel?.connections ?? []).filter(
        (candidate) => candidate.childRoomId !== connection.childRoomId,
      ),
      { ...connection, createdAt: connection.createdAt ?? new Date().toISOString() },
    ],
  };
  return { ...project, spatialModel };
}

export function addRoomToSpatialModel(project: Project, roomId: string): Project {
  return {
    ...project,
    spatialModel: {
      coordinateSystem: "project-local",
      roomTransforms: {
        ...(project.spatialModel?.roomTransforms ?? {}),
        [roomId]: project.spatialModel?.roomTransforms[roomId] ?? identityTransform(),
      },
      connections: project.spatialModel?.connections ?? [],
    },
  };
}

export function removeRoomFromProject(project: Project, roomId: string): Project {
  const removedSurfaceIds = new Set(
    project.roomCaptures.find((room) => room.id === roomId)?.surfaces.map((surface) => surface.id) ?? [],
  );
  const removedObjectIds = new Set(
    project.placedObjects.filter((object) => object.roomCaptureId === roomId).map((object) => object.id),
  );
  const removedAnchorIds = new Set(
    project.anchors.filter((anchor) => anchor.roomCaptureId === roomId).map((anchor) => anchor.id),
  );
  const remainingTransforms = { ...(project.spatialModel?.roomTransforms ?? {}) };
  delete remainingTransforms[roomId];
  return {
    ...project,
    roomCaptures: project.roomCaptures.filter((room) => room.id !== roomId),
    placedObjects: project.placedObjects.filter((object) => !removedObjectIds.has(object.id)),
    anchors: project.anchors.filter(
      (anchor) =>
        !removedAnchorIds.has(anchor.id) &&
        !removedSurfaceIds.has(anchor.reference.surfaceId),
    ),
    validationIssues: project.validationIssues.filter(
      (issue) =>
        (!issue.objectId || !removedObjectIds.has(issue.objectId)) &&
        (!issue.surfaceId || !removedSurfaceIds.has(issue.surfaceId)),
    ),
    spatialModel: project.spatialModel
      ? {
          ...project.spatialModel,
          roomTransforms: remainingTransforms,
          connections: project.spatialModel.connections.filter(
            (connection) => connection.parentRoomId !== roomId && connection.childRoomId !== roomId,
          ),
        }
      : project.spatialModel,
  };
}

export function clearSavedRoomScansFromProject(project: Project): Project {
  const scanRoomIds = new Set(
    project.roomCaptures.filter((room) => room.source === "roomplan" || room.roomScan).map((room) => room.id),
  );
  return scanRoomIds.size === 0
    ? project
    : scanRoomIds.values().reduce((current, roomId) => removeRoomFromProject(current, roomId), project);
}
