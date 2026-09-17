import type { Transform3D, Vec3 } from "./spatial";

/** Row-major matrices, column vectors, meters, right-handed Y-up (ARKit/SceneKit). */
export function multiplyMatrices(a: number[], b: number[]): number[] {
  return Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].reduce((sum, k) => sum + a[Math.floor(i / 4) * 4 + k] * b[k * 4 + i % 4], 0));
}

export function validMatrix(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 16 && value.every(v => typeof v === "number" && Number.isFinite(v)) &&
    Math.abs(value[12]) < 1e-9 && Math.abs(value[13]) < 1e-9 && Math.abs(value[14]) < 1e-9 && Math.abs(value[15] - 1) < 1e-9;
}

const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? (value === 0 ? 0 : value) : fallback;

/** Complete missing legacy TRS fields; a valid matrix is always authoritative. */
export function canonicalTransform(input?: Partial<Transform3D> | null): Transform3D {
  const t: Transform3D = {
    position: { x: finite(input?.position?.x, 0), y: finite(input?.position?.y, 0), z: finite(input?.position?.z, 0) },
    rotation: { pitch: finite(input?.rotation?.pitch, 0), yaw: finite(input?.rotation?.yaw, 0), roll: finite(input?.rotation?.roll, 0) },
    scale: { x: finite(input?.scale?.x, 1), y: finite(input?.scale?.y, 1), z: finite(input?.scale?.z, 1) },
  };
  if (!validMatrix(input?.matrix)) {
    const { pitch: x, yaw: y, roll: z } = t.rotation;
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    const m = multiplyMatrices([cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], multiplyMatrices(
      [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0, 0, 0, 0, 1]));
    for (const row of [0, 1, 2]) { m[row * 4] *= t.scale.x; m[row * 4 + 1] *= t.scale.y; m[row * 4 + 2] *= t.scale.z; }
    m[3] = t.position.x; m[7] = t.position.y; m[11] = t.position.z;
    return { ...t, matrix: m.map(value => value === 0 ? 0 : value) };
  }
  const m = input.matrix.map(value => value === 0 ? 0 : value);
  const determinant = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
  const scale = { x: Math.hypot(m[0], m[4], m[8]) * (determinant < 0 ? -1 : 1), y: Math.hypot(m[1], m[5], m[9]), z: Math.hypot(m[2], m[6], m[10]) };
  const yaw = Math.asin(Math.max(-1, Math.min(1, -m[8] / (scale.x || 1)))) || 0;
  // TRS is descriptive. Shear/full matrix is retained losslessly, never rebaked.
  return { matrix: m, position: { x: m[3], y: m[7], z: m[11] }, scale, rotation: {
    yaw, pitch: Math.abs(Math.cos(yaw)) > 1e-7 ? Math.atan2(m[9] / (scale.y || 1), m[10] / (scale.z || 1)) : 0,
    roll: Math.abs(Math.cos(yaw)) > 1e-7 ? Math.atan2(m[4] / (scale.x || 1), m[0] / (scale.x || 1)) : Math.atan2(-m[1] / (scale.y || 1), m[5] / (scale.y || 1)),
  } };
}

export function assemblyMatrix(t?: Partial<Transform3D>): number[] { return canonicalTransform(t).matrix!; }

/** Legacy RoomPlan yaw had the opposite sign. Convert once, preserving original data. */
export function capturedTransform(t?: Partial<Transform3D>): Transform3D {
  if (validMatrix(t?.matrix)) return canonicalTransform(t);
  const safe = canonicalTransform(t);
  return canonicalTransform({ ...safe, matrix: undefined, rotation: { ...safe.rotation, yaw: -safe.rotation.yaw } });
}

export function composeTransforms(parent?: Partial<Transform3D>, child?: Partial<Transform3D>): Transform3D {
  return canonicalTransform({ matrix: multiplyMatrices(assemblyMatrix(parent), assemblyMatrix(child)) });
}

/** Inverse supports translation, rotation, scale and shear; singular transforms are rejected. */
export function inverseTransform(t?: Partial<Transform3D>): Transform3D | null {
  const m = assemblyMatrix(t);
  const rows = Array.from({ length: 4 }, (_, i) => [...m.slice(i * 4, i * 4 + 4), ...[0, 1, 2, 3].map(j => i === j ? 1 : 0)]);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column]; rows[column] = rows[column].map(value => value / divisor);
    for (let row = 0; row < 4; row++) if (row !== column) {
      const factor = rows[row][column]; rows[row] = rows[row].map((value, j) => value - factor * rows[column][j]);
    }
  }
  const inverse = rows.flatMap(row => row.slice(4));
  return validMatrix(inverse) ? canonicalTransform({ matrix: inverse }) : null;
}

/** parent^-1 × world. Never substitute assembly coordinates for an AR-session mapping. */
export function relativeTransform(parent: Transform3D, world: Transform3D): Transform3D | null {
  const inverse = inverseTransform(parent);
  return inverse ? composeTransforms(inverse, world) : null;
}

export function alignRoomFeatures(parentRoom: Transform3D, parentFeature: Transform3D, childFeature: Transform3D): Transform3D | null {
  const inverse = inverseTransform(childFeature);
  return inverse ? composeTransforms(composeTransforms(parentRoom, parentFeature), inverse) : null;
}

/** Two gravity-aligned physical correspondences establish room -> current AR session. */
export function roomToARFromPointPairs(localA: Vec3, localB: Vec3, worldA: Vec3, worldB: Vec3): Transform3D | null {
  if (![localA, localB, worldA, worldB].every(p => Object.values(p).every(Number.isFinite))) return null;
  const localLength = Math.hypot(localB.x - localA.x, localB.z - localA.z);
  const worldLength = Math.hypot(worldB.x - worldA.x, worldB.z - worldA.z);
  if (Math.min(localLength, worldLength) < 0.3 || Math.abs(localLength - worldLength) > Math.max(0.1, localLength * 0.05) || Math.abs((localB.y - localA.y) - (worldB.y - worldA.y)) > 0.1) return null;
  const yaw = Math.atan2(localB.z - localA.z, localB.x - localA.x) - Math.atan2(worldB.z - worldA.z, worldB.x - worldA.x);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return canonicalTransform({ rotation: { pitch: 0, yaw, roll: 0 }, position: { x: worldA.x - c * localA.x - s * localA.z, y: worldA.y - localA.y, z: worldA.z + s * localA.x - c * localA.z } });
}
