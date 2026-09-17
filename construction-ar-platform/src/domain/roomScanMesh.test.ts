import { describe, expect, it } from "vitest";

import type { RoomScanMeshAnchor } from "./projects";
import { decodeTriangleIndices, mergeRoomScanMeshAnchors, transformPoint, validateRoomScanMeshAnchor } from "./roomScanMesh";

const identity = { position: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 }, scale: { x: 1, y: 1, z: 1 } };
const translated = { ...identity, position: { x: 10, y: 2, z: -4 }, matrix: [1, 0, 0, 10, 0, 1, 0, 2, 0, 0, 1, -4, 0, 0, 0, 1] };

function anchor(id: string, transform = identity): RoomScanMeshAnchor {
  return {
    id,
    transform,
    vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
    indices: [0, 1, 2],
    faceCount: 1,
    indexCount: 3,
    bytesPerIndex: 2,
    indexCountPerPrimitive: 3,
  };
}

describe("persisted RoomPlan AR mesh geometry", () => {
  it("round-trips one anchor and reconstructs expected world positions", () => {
    const source = anchor("one", translated);
    const loaded = JSON.parse(JSON.stringify(source)) as RoomScanMeshAnchor;
    expect(validateRoomScanMeshAnchor(loaded).valid).toBe(true);
    expect(loaded.vertices).toEqual(source.vertices);
    expect(loaded.indices).toEqual(source.indices);
    expect(loaded.transform.matrix).toEqual(source.transform.matrix);
    expect(transformPoint(loaded.vertices[1], loaded.transform)).toEqual({ x: 11, y: 2, z: -4 });
  });

  it("rebases indexes when two independent local anchor spaces are merged", () => {
    const merged = mergeRoomScanMeshAnchors([anchor("a"), anchor("b", translated)]);
    expect(merged.vertices).toHaveLength(6);
    expect(merged.indices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(validateRoomScanMeshAnchor(merged).valid).toBe(true);
  });

  it("decodes UInt16 triangle indexes", () => {
    const bytes = new Uint8Array([0, 0, 1, 0, 2, 0]);
    expect(decodeTriangleIndices(bytes, 2, 3)).toEqual([0, 1, 2]);
  });

  it("decodes UInt32 triangle indexes", () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0]);
    expect(decodeTriangleIndices(bytes, 4, 3)).toEqual([0, 1, 2]);
  });

  it("rejects invalid indexes, malformed triangle grouping, and non-finite coordinates", () => {
    expect(validateRoomScanMeshAnchor({ ...anchor("bad-index"), indices: [0, 1, 99] }).valid).toBe(false);
    expect(validateRoomScanMeshAnchor({ ...anchor("bad-group"), indices: [0, 1, 2, 1] }).errors).toContain("index count is not a non-zero multiple of three");
    expect(validateRoomScanMeshAnchor({ ...anchor("bad-number"), vertices: [{ x: Number.NaN, y: 0, z: 0 }, ...anchor("copy").vertices.slice(1)] }).errors).toContain("vertex contains NaN or infinity");
    expect(validateRoomScanMeshAnchor({ ...anchor("bad-infinity"), vertices: [{ x: Number.POSITIVE_INFINITY, y: 0, z: 0 }, ...anchor("copy").vertices.slice(1)] }).errors).toContain("vertex contains NaN or infinity");
    expect(() => decodeTriangleIndices(new Uint8Array([0, 0, 3, 0, 2, 0]), 2, 3)).toThrow(/outside vertex count/);
  });

  it("handles empty and unsupported mesh states without accepting them", () => {
    expect(validateRoomScanMeshAnchor({ ...anchor("empty-vertices"), vertices: [], indices: [] }).valid).toBe(false);
    expect(validateRoomScanMeshAnchor({ ...anchor("empty-faces"), indices: [] }).valid).toBe(false);
    expect(() => decodeTriangleIndices(new Uint8Array(), 3, 0)).toThrow(/Unsupported triangle index width/);
    expect(() => decodeTriangleIndices(new Uint8Array(), 2, -1)).toThrow(/Invalid vertex count/);
  });

  it("calculates local and world bounding boxes", () => {
    const result = validateRoomScanMeshAnchor(anchor("bounds", translated));
    expect(result.localBounds).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } });
    expect(result.worldBounds).toEqual({ min: { x: 10, y: 2, z: -4 }, max: { x: 11, y: 3, z: -4 } });
  });
});
