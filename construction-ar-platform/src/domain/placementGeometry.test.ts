import { describe, expect, it } from "vitest";
import { canonicalTransform, composeTransforms } from "./spatialTransforms";
import { placementBox, placementBoxesOverlap } from "./placementGeometry";
import type { Dimensions3D } from "./spatial";
const size = (width = 2, height = 1, depth = 0.2): Dimensions3D => ({ width, height, depth, unit: "m" });
const pose = (x = 0, z = 0, yaw = 0) => canonicalTransform({ position: { x, y: 0, z }, rotation: { pitch: 0, yaw, roll: 0 } });
const overlap = (a: ReturnType<typeof pose>, b: ReturnType<typeof pose>, dimensions = size()) => placementBoxesOverlap(placementBox(a, dimensions)!, placementBox(b, dimensions)!);
describe("oriented planning envelopes", () => {
  it("uses rotation to detect an overlap missed by unrotated dimensions", () => {
    expect(overlap(pose(), pose(0, 0.8))).toBe(false);
    expect(overlap(pose(0, 0, Math.PI / 2), pose(0, 0.8))).toBe(true);
  });
  it("separates parallel diagonal objects even when world-axis bounds overlap", () => {
    expect(overlap(pose(0, 0, Math.PI / 4), pose(0.3, 0.3, Math.PI / 4))).toBe(false);
    expect(overlap(pose(0, 0, Math.PI / 4), pose(0.05, 0.05, Math.PI / 4))).toBe(true);
  });
  it("retains matrix translation and scale, converts units, and excludes touching faces", () => {
    const scaled = canonicalTransform({ scale: { x: 2, y: 1, z: 1 } });
    expect(overlap(scaled, pose(2.5))).toBe(true);
    expect(overlap(pose(), pose(2))).toBe(false);
    const metric = placementBox(pose(), size(1, 1, 1))!;
    const inches = placementBox(pose(), { width: 1 / 0.0254, height: 1 / 0.0254, depth: 1 / 0.0254, unit: "in" })!;
    expect(inches.corners).toEqual(metric.corners);
    const moved = composeTransforms(pose(10), pose());
    expect(overlap(moved, pose())).toBe(false);
  });
  it("rejects invalid dimensions and singular transforms", () => {
    expect(placementBox(pose(), size(NaN))).toBeUndefined();
    expect(placementBox(pose(), size(0))).toBeUndefined();
    expect(placementBox(canonicalTransform({ scale: { x: 0, y: 1, z: 1 } }), size())).toBeUndefined();
  });
});
