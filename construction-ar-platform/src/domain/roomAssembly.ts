import { identityTransform, type Project, type RoomCapture } from "./projects";
import type { Transform3D, Vec3 } from "./spatial";
import { transformPoint } from "./roomScanMesh";

export { multiplyMatrices, assemblyMatrix, capturedTransform } from "./spatialTransforms";
import { multiplyMatrices, assemblyMatrix, capturedTransform, canonicalTransform } from "./spatialTransforms";

/** Bounds are used only for staging/pivots, never to regenerate captured geometry. */
export function roomAssemblyBounds(room: RoomCapture): { min: Vec3; max: Vec3; center: Vec3 } {
  const points = (room.roomScan?.elements ?? []).flatMap((e) => {
    const { width: w = 0, height: h = 0, depth: d = 0 } = e.dimensions ?? {};
    const local = e.polygonCorners?.length ? e.polygonCorners : [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => ({ x: x * w / 2, y: y * h / 2, z: z * d / 2 }))));
    return local.map(p => transformPoint(p, { ...e.transform, matrix: assemblyMatrix(e.roomLocalTransform ?? capturedTransform(e.transform)) }));
  }).filter(p => Object.values(p).every(Number.isFinite));
  const min = { x: 0, y: 0, z: 0 }, max = { ...min };
  if (points.length) for (const axis of ["x", "y", "z"] as const) {
    min[axis] = Math.min(...points.map(p => p[axis])); max[axis] = Math.max(...points.map(p => p[axis]));
  }
  return { min, max, center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 } };
}

export function moveAssemblyRoom(t: Transform3D, axis: "x" | "y" | "z", amount: number): Transform3D {
  const matrix = assemblyMatrix(t);
  matrix[{ x: 3, y: 7, z: 11 }[axis]] += amount;
  return { ...t, matrix, position: { x: matrix[3], y: matrix[7], z: matrix[11] } };
}

/** Rotate the whole room about its own captured center, preserving scale/tilt. */
export function rotateAssemblyRoom(t: Transform3D, radians: number, center: Vec3): Transform3D {
  const matrix = assemblyMatrix(t);
  const pivot = transformPoint(center, { ...t, matrix });
  const c = Math.cos(radians), s = Math.sin(radians);
  const rotation = [c, 0, s, pivot.x - c * pivot.x - s * pivot.z, 0, 1, 0, 0, -s, 0, c, pivot.z + s * pivot.x - c * pivot.z, 0, 0, 0, 1];
  const result = multiplyMatrices(rotation, matrix);
  return { ...t, matrix: result, position: { x: result[3], y: result[7], z: result[11] }, rotation: { ...t.rotation, yaw: t.rotation.yaw + radians } };
}

function isIdentity(t?: Transform3D): boolean {
  if (!t) return true;
  const identity = assemblyMatrix(identityTransform());
  return assemblyMatrix(t).every((v, i) => Math.abs(v - identity[i]) < 1e-8);
}

/** Stage only rooms without saved placement; an explicit identity is valid once initialized. */
export function initialAssemblyTransforms(project: Project, reset = false): Record<string, Transform3D> {
  const saved = reset ? {} : Object.fromEntries(Object.entries(project.spatialModel?.roomTransforms ?? {}).map(([id, t]) => [id, canonicalTransform(t)]));
  const result = { ...saved };
  let cursor = 0;
  const rooms = project.roomCaptures.filter(r => r.roomScan);
  const placed = rooms.filter(r => !reset && (project.spatialModel?.assemblyRoomIds?.includes(r.id) || !isIdentity(saved[r.id]) || project.spatialModel?.connections?.some(c => c.parentRoomId === r.id || c.childRoomId === r.id)));
  for (const room of placed) {
    const bounds = roomAssemblyBounds(room), t = saved[room.id] ?? identityTransform();
    result[room.id] = t;
    for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) {
      cursor = Math.max(cursor, transformPoint({ x, y: 0, z }, { ...t, matrix: assemblyMatrix(t) }).x + 1.5);
    }
  }
  for (const room of rooms.filter(r => !placed.includes(r))) {
    const b = roomAssemblyBounds(room), t = identityTransform();
    t.position = { x: cursor - b.min.x, y: -b.min.y, z: -b.min.z };
    result[room.id] = t;
    cursor += Math.max(b.max.x - b.min.x, 1) + 1.5;
  }
  return result;
}

export function updateAssemblyTransform(transforms: Record<string, Transform3D>, roomId: string, next: Transform3D, lockedRoomId?: string): Record<string, Transform3D> {
  return roomId === lockedRoomId ? transforms : { ...transforms, [roomId]: next };
}

export function saveAssemblyToProject(project: Project, transforms: Record<string, Transform3D>, lockedRoomId?: string): Project {
  const ids = project.roomCaptures.filter(r => r.roomScan).map(r => r.id);
  return { ...project, spatialModel: {
    ...project.spatialModel, coordinateSystem: "project-local",
    roomTransforms: { ...project.spatialModel?.roomTransforms, ...Object.fromEntries(ids.filter(id => transforms[id]).map(id => [id,
      id === lockedRoomId && project.spatialModel?.lockedRoomId === lockedRoomId && project.spatialModel?.roomTransforms?.[id]
        ? project.spatialModel.roomTransforms[id] : canonicalTransform(transforms[id])])) },
    assemblyRoomIds: ids, lockedRoomId: ids.includes(lockedRoomId ?? "") ? lockedRoomId : undefined,
    connections: project.spatialModel?.connections ?? [],
  } };
}

export function roomDimensionLabel(room: RoomCapture): string {
  const scan = room.roomScan;
  const d = room.measuredDimensions;
  // Only use stored room-level measurements; do not infer height from furniture.
  const values = [
    ["H", scan?.ceilingHeight ?? d?.height, scan?.ceilingHeight != null ? "m" : d?.unit],
    ["W", scan?.floorFootprint?.width ?? d?.width, scan?.floorFootprint ? "m" : d?.unit],
    ["L", scan?.floorFootprint?.depth ?? d?.depth, scan?.floorFootprint ? "m" : d?.unit],
  ] as const;
  return values.filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0).map(([axis, v, unit]) => `${axis}: ${v!.toFixed(2)} ${unit ?? "m"}`).join(" · ");
}
