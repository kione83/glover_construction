import type { Dimensions3D, Transform3D, Vec3 } from "./spatial";
import { canonicalTransform } from "./spatialTransforms";

const METERS_PER_UNIT = { in: 0.0254, ft: 0.3048, mm: 0.001, cm: 0.01, m: 1 } as const;
export interface PlacementBox { corners: Vec3[]; edges: Vec3[] }
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Metric, transformed catalog envelope. Retains rotation, nonuniform scale and matrix poses. */
export function placementBox(transform: Transform3D, dimensions: Dimensions3D): PlacementBox | undefined {
  const factor = METERS_PER_UNIT[dimensions.unit];
  const sizes = [dimensions.width, dimensions.height, dimensions.depth].map(value => value * factor);
  if (sizes.some(value => !Number.isFinite(value) || value <= 0)) return undefined;
  const m = canonicalTransform(transform).matrix!;
  const edges = [0, 1, 2].map(column => ({ x: m[column], y: m[4 + column], z: m[8 + column] }));
  if (Math.abs(dot(edges[0], cross(edges[1], edges[2]))) < 1e-10) return undefined;
  const corners = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => {
    const local = [x * sizes[0] / 2, y * sizes[1] / 2, z * sizes[2] / 2];
    return {
      x: m[0] * local[0] + m[1] * local[1] + m[2] * local[2] + m[3],
      y: m[4] * local[0] + m[5] * local[1] + m[6] * local[2] + m[7],
      z: m[8] * local[0] + m[9] * local[1] + m[10] * local[2] + m[11],
    };
  })));
  return { corners, edges };
}

/** Separating-axis test for transformed boxes; touching faces are not penetration. */
export function placementBoxesOverlap(first: PlacementBox, second: PlacementBox): boolean {
  const faceNormals = ({ edges }: PlacementBox) => [cross(edges[0], edges[1]), cross(edges[1], edges[2]), cross(edges[2], edges[0])];
  const axes = [...faceNormals(first), ...faceNormals(second), ...first.edges.flatMap(a => second.edges.map(b => cross(a, b)))];
  for (const axis of axes) {
    const length = Math.hypot(axis.x, axis.y, axis.z);
    if (length < 1e-10) continue;
    const unit = { x: axis.x / length, y: axis.y / length, z: axis.z / length };
    const a = first.corners.map(point => dot(point, unit));
    const b = second.corners.map(point => dot(point, unit));
    if (Math.max(...a) <= Math.min(...b) + 1e-8 || Math.max(...b) <= Math.min(...a) + 1e-8) return false;
  }
  return true;
}
