import type { RoomScanMeshAnchor } from "./projects";
import type { Transform3D, Vec3 } from "./spatial";

export interface MeshBounds {
  min: Vec3;
  max: Vec3;
}

export interface MeshValidationResult {
  valid: boolean;
  errors: string[];
  vertexCount: number;
  faceCount: number;
  indexCount: number;
  minIndex: number;
  maxIndex: number;
  localBounds?: MeshBounds;
  worldBounds?: MeshBounds;
}

const MAX_REASONABLE_COORDINATE_METERS = 10_000;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteVector(value: Vec3): boolean {
  return finite(value.x) && finite(value.y) && finite(value.z);
}

function emptyBounds(point: Vec3): MeshBounds {
  return { min: { ...point }, max: { ...point } };
}

function includePoint(bounds: MeshBounds, point: Vec3): void {
  bounds.min.x = Math.min(bounds.min.x, point.x);
  bounds.min.y = Math.min(bounds.min.y, point.y);
  bounds.min.z = Math.min(bounds.min.z, point.z);
  bounds.max.x = Math.max(bounds.max.x, point.x);
  bounds.max.y = Math.max(bounds.max.y, point.y);
  bounds.max.z = Math.max(bounds.max.z, point.z);
}

function boundsFor(points: Vec3[]): MeshBounds | undefined {
  const first = points[0];
  if (!first) return undefined;
  const bounds = emptyBounds(first);
  points.slice(1).forEach((point) => includePoint(bounds, point));
  return bounds;
}

export function transformPoint(point: Vec3, transform: Transform3D): Vec3 {
  const matrix = transform.matrix;
  if (matrix?.length === 16) {
    return {
      x: matrix[0] * point.x + matrix[1] * point.y + matrix[2] * point.z + matrix[3],
      y: matrix[4] * point.x + matrix[5] * point.y + matrix[6] * point.z + matrix[7],
      z: matrix[8] * point.x + matrix[9] * point.y + matrix[10] * point.z + matrix[11],
    };
  }

  const scaled = {
    x: point.x * transform.scale.x,
    y: point.y * transform.scale.y,
    z: point.z * transform.scale.z,
  };
  const cos = Math.cos(transform.rotation.yaw);
  const sin = Math.sin(transform.rotation.yaw);
  return {
    x: transform.position.x + scaled.x * cos - scaled.z * sin,
    y: transform.position.y + scaled.y,
    z: transform.position.z + scaled.x * sin + scaled.z * cos,
  };
}

export function validateRoomScanMeshAnchor(anchor: RoomScanMeshAnchor): MeshValidationResult {
  const errors: string[] = [];
  const vertices = anchor.vertices ?? [];
  const indices = anchor.indices ?? [];
  const indexCountPerPrimitive = anchor.indexCountPerPrimitive ?? 3;
  const faceCount = indexCountPerPrimitive > 0 ? Math.floor(indices.length / indexCountPerPrimitive) : 0;
  const minIndex = indices.length > 0 ? Math.min(...indices) : -1;
  const maxIndex = indices.length > 0 ? Math.max(...indices) : -1;

  if (vertices.length < 3) errors.push("fewer than three vertices");
  if (indexCountPerPrimitive !== 3) errors.push(`indexCountPerPrimitive=${indexCountPerPrimitive}, expected 3`);
  if (indices.length === 0 || indices.length % 3 !== 0) errors.push("index count is not a non-zero multiple of three");
  if (anchor.indexCount !== undefined && anchor.indexCount !== indices.length) errors.push("declared indexCount does not match indices");
  if (anchor.faceCount !== undefined && anchor.faceCount !== faceCount) errors.push("declared faceCount does not match indices");
  if (anchor.bytesPerIndex !== undefined && anchor.bytesPerIndex !== 2 && anchor.bytesPerIndex !== 4) errors.push("bytesPerIndex must be 2 or 4");
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= vertices.length)) errors.push("index points outside the local vertex buffer");
  if (vertices.some((point) => !finiteVector(point))) errors.push("vertex contains NaN or infinity");
  if (anchor.transform.matrix && (anchor.transform.matrix.length !== 16 || anchor.transform.matrix.some((value) => !finite(value)))) errors.push("transform matrix is not a finite 4x4 matrix");
  if (![anchor.transform.position, anchor.transform.rotation, anchor.transform.scale].every((value) => Object.values(value).every(finite))) errors.push("transform contains NaN or infinity");

  const localBounds = vertices.every(finiteVector) ? boundsFor(vertices) : undefined;
  const worldVertices = vertices.map((point) => transformPoint(point, anchor.transform));
  if (worldVertices.some((point) => !finiteVector(point))) errors.push("world vertex contains NaN or infinity");
  const worldBounds = worldVertices.every(finiteVector) ? boundsFor(worldVertices) : undefined;
  const allCoordinates = [...vertices, ...worldVertices].flatMap((point) => [point.x, point.y, point.z]);
  if (allCoordinates.some((value) => Math.abs(value) > MAX_REASONABLE_COORDINATE_METERS)) errors.push("coordinate exceeds the corruption sanity limit");

  return {
    valid: errors.length === 0,
    errors,
    vertexCount: vertices.length,
    faceCount,
    indexCount: indices.length,
    minIndex,
    maxIndex,
    localBounds,
    worldBounds,
  };
}

export function decodeTriangleIndices(bytes: Uint8Array, bytesPerIndex: number, vertexCount: number): number[] {
  if (bytesPerIndex !== 2 && bytesPerIndex !== 4) throw new Error(`Unsupported triangle index width: ${bytesPerIndex}.`);
  if (!Number.isInteger(vertexCount) || vertexCount < 0) throw new Error(`Invalid vertex count: ${vertexCount}.`);
  if (bytes.length % (bytesPerIndex * 3) !== 0) throw new Error("Triangle index buffer is not aligned to complete primitives.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const indices: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += bytesPerIndex) {
    const value = bytesPerIndex === 2 ? view.getUint16(offset, true) : view.getUint32(offset, true);
    if (value >= vertexCount) throw new Error(`Triangle index ${value} is outside vertex count ${vertexCount}.`);
    indices.push(value);
  }
  return indices;
}

/** Diagnostic/test helper for the alternative merged representation. Runtime rendering keeps anchors independent. */
export function mergeRoomScanMeshAnchors(anchors: RoomScanMeshAnchor[]): RoomScanMeshAnchor {
  const vertices: Vec3[] = [];
  const indices: number[] = [];
  anchors.forEach((anchor) => {
    const validation = validateRoomScanMeshAnchor(anchor);
    if (!validation.valid) throw new Error(`Cannot merge invalid mesh anchor ${anchor.id}: ${validation.errors.join(", ")}`);
    const vertexOffset = vertices.length;
    vertices.push(...anchor.vertices.map((point) => transformPoint(point, anchor.transform)));
    indices.push(...anchor.indices.map((index) => index + vertexOffset));
  });
  return {
    id: "merged-diagnostic-mesh",
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    vertices,
    indices,
    faceCount: indices.length / 3,
    indexCount: indices.length,
    bytesPerIndex: 4,
    indexCountPerPrimitive: 3,
  };
}
