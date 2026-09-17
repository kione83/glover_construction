import { describe, expect, it } from "vitest";
import type { RoomCapture, RoomScanData, RoomScanElement, RoomScanMeasurement } from "./projects";
import { identityTransform } from "./projects";
import { deriveObjectMeasurements, formatObjectDimensions, formatObjectMeasurementDetails, measurementsForLiveObject, normalizeScanObjects } from "./scannedObjects";
import { formatMetricPower } from "./measurementUnits";
import { createEmptyProjectDocument, hydrateProjectDocument } from "../storage/projectDocument";

function chair(id: string, overrides: Partial<RoomScanElement> = {}): RoomScanElement {
  return { id, kind: "furniture", category: "chair", representation: "chair", dimensions: { width: 0.5, depth: 0.5, height: 0.9, unit: "m" }, confidence: 0.95, transform: identityTransform(), ...overrides };
}
function scan(elements: RoomScanElement[]): RoomScanData {
  return { version: 1, source: "roomplan", capturedAt: "2026-09-14", elements, portal: { format: "construction-ar-room-scan", version: 1 } };
}
function room(id: string, elements: RoomScanElement[]): RoomCapture {
  return { id, name: id, source: "roomplan", status: "completed", unit: "m", surfaces: [], roomScan: scan(elements) };
}

describe("object-local dimensions and derived measurements", () => {
  it("persists W/D/H and all three metric products through project JSON hydration", () => {
    const doc = createEmptyProjectDocument({ id: "project", name: "Site", roomCaptures: [room("room", [chair("a", { dimensions: { width: 2, depth: 3, height: 4, unit: "m" } })])] });
    const reopened = hydrateProjectDocument(JSON.parse(JSON.stringify(doc)))!;
    const type = reopened.project.roomCaptures[0].roomScan!.objectTypes![0];
    expect(type.dimensions).toEqual({ width: 2, depth: 3, height: 4, unit: "m" });
    expect(type.footprintArea).toBe(6);
    expect(type.faceArea).toBe(8);
    expect(type.boundingVolume).toBe(24);
    expect(reopened.schemaVersion).toBe(8);
  });

  it("calculates only the products whose axes are available", () => {
    const noHeight = deriveObjectMeasurements({ width: 2, depth: 3, unit: "m" }, 0.7);
    expect(noHeight.dimensions.height).toBeNull();
    expect(noHeight.footprintArea).toBe(6);
    expect(noHeight.faceArea).toBeNull();
    expect(noHeight.boundingVolume).toBeNull();
    const noDepth = deriveObjectMeasurements({ width: 2, height: 4, unit: "m" }, 0.7);
    expect(noDepth.faceArea).toBe(8);
    expect(noDepth.footprintArea).toBeNull();
    expect(noDepth.boundingVolume).toBeNull();
  });

  it.each([0, -1, NaN, Infinity])("rejects unusable geometry %s without inventing an extent", invalid => {
    const values = deriveObjectMeasurements({ width: invalid, depth: 3, height: 4, unit: "m" }, 0.95);
    expect(values.dimensions.width).toBeNull();
    expect(values.footprintArea).toBeNull();
    expect(values.faceArea).toBeNull();
    expect(values.boundingVolume).toBeNull();
  });

  it.each([undefined, 0.4, NaN, 1.5])("withholds derived quantities for uncertain confidence %s", confidence => {
    const values = deriveObjectMeasurements(chair("a").dimensions, confidence);
    expect(values.dimensions.width).toBe(0.5); // raw estimated length is still available
    expect(values.footprintArea).toBeNull();
    expect(values.faceArea).toBeNull();
    expect(values.boundingVolume).toBeNull();
  });

  it("uses limited axis evidence to withhold only affected products", () => {
    const values = deriveObjectMeasurements({ width: 2, depth: 3, height: 4, unit: "m" }, 0.95, [{ dimension: "depth", value: 3, quality: "limited", status: "limited" }]);
    expect(values.footprintArea).toBeNull();
    expect(values.faceArea).toBe(8);
    expect(values.boundingVolume).toBeNull();
  });

  it("does not infer units for incomplete legacy records", () => {
    const values = deriveObjectMeasurements({ width: 2, depth: 3, height: 4 }, 0.95);
    expect(values.dimensions).toEqual({ width: null, depth: null, height: null, unit: "m" });
  });

  it("does not substitute smoothed history for the captured local geometry", () => {
    const s = scan([chair("a")]);
    s.measurements = [{ elementId: "a", dimension: "width", value: 12, confidence: 0.95, quality: "stable" } as RoomScanMeasurement];
    expect(normalizeScanObjects(s, "room").objectTypes![0].dimensions.width).toBe(0.5);
  });
});

describe("conservative room-scoped object grouping", () => {
  it("groups four chairs while preserving every ID, transform, scale, matrix and room reference", () => {
    const instances = [0, 1, 2, 3].map(index => chair(`chair-${index}`, {
      transform: { position: { x: index * 2, y: 0.5, z: -index }, rotation: { pitch: 0.1, yaw: index * Math.PI / 2, roll: 0.2 }, scale: { x: 1, y: 1.1, z: 1 }, matrix: [1, 0, 0, index * 2, 0, 1, 0, 0.5, 0, 0, 1, -index, 0, 0, 0, 1] },
    }));
    const before = JSON.stringify(instances);
    const grouped = normalizeScanObjects(scan(instances), "dining-room");
    expect(grouped.objectTypes).toHaveLength(1);
    expect(grouped.objectTypes![0].quantity).toBe(4);
    expect(grouped.elements).toHaveLength(4);
    expect(new Set(grouped.elements.map(item => item.id)).size).toBe(4);
    expect(grouped.elements.map(item => item.transform)).toEqual(instances.map(item => item.transform));
    expect(grouped.elements.map(item => item.dimensions)).toEqual(instances.map(item => item.dimensions));
    expect(grouped.elements.every(item => item.roomCaptureId === "dining-room" && item.objectTypeId === grouped.objectTypes![0].id)).toBe(true);
    expect(JSON.stringify(instances)).toBe(before);
  });

  it("groups small variations but retains the original per-instance sizes", () => {
    const a = chair("a"), b = chair("b", { dimensions: { width: 0.51, depth: 0.49, height: 0.91, unit: "m" } });
    const grouped = normalizeScanObjects(scan([a, b]), "room");
    expect(grouped.objectTypes).toHaveLength(1);
    expect(grouped.objectTypes![0].quantity).toBe(2);
    expect(grouped.elements[1].dimensions).toEqual(b.dimensions);
    expect(grouped.objectTypes![0].dimensions).toEqual(a.dimensions);
  });

  it.each(["width", "depth", "height"] as const)("does not group materially different %s", axis => {
    const a = chair("a");
    const b = chair("b", { dimensions: { ...a.dimensions, [axis]: a.dimensions[axis] + 0.021 } });
    expect(normalizeScanObjects(scan([a, b]), "room").objectTypes).toHaveLength(2);
  });

  it("also enforces the relative limit on small items", () => {
    const a = chair("a", { dimensions: { width: 0.1, depth: 0.1, height: 0.1, unit: "m" } });
    const b = chair("b", { dimensions: { ...a.dimensions, width: 0.11 } });
    expect(normalizeScanObjects(scan([a, b]), "room").objectTypes).toHaveLength(2);
  });

  it("prevents tolerance chains and is deterministic after reorder or repeat normalization", () => {
    const objects = [0, 0.014, 0.028].map((delta, index) => chair(`${index}`, { dimensions: { width: 0.5 + delta, depth: 0.5, height: 0.9, unit: "m" } }));
    const grouped = normalizeScanObjects(scan(objects), "room");
    expect(grouped.objectTypes!.map(type => type.quantity)).toEqual([2, 1]);
    expect(normalizeScanObjects(scan([...objects].reverse()), "room").objectTypes).toEqual(grouped.objectTypes);
    expect(normalizeScanObjects(grouped, "room")).toEqual(grouped);
  });

  it("keeps different categories, unknown categories, incomplete and low-confidence objects separate", () => {
    const pairs = [
      [chair("a"), chair("b", { category: "table" })],
      [chair("a", { category: "unknown" }), chair("b", { category: "unknown" })],
      [chair("a", { confidence: 0.4 }), chair("b", { confidence: 0.4 })],
      [chair("a", { dimensions: undefined as unknown as RoomScanElement["dimensions"] }), chair("b")],
    ];
    for (const pair of pairs) expect(normalizeScanObjects(scan(pair), "room").objectTypes!.map(type => type.quantity)).toEqual([1, 1]);
  });

  it("does not turn architecture into object types or merge separate rooms", () => {
    const wall = chair("wall", { kind: "wall", category: "wall", representation: "wall" });
    const doc = createEmptyProjectDocument({ id: "p", name: "p", roomCaptures: [room("one", [wall, chair("a")]), room("two", [chair("a")])] });
    const [one, two] = doc.project.roomCaptures.map(item => item.roomScan!);
    expect(one.objectTypes).toHaveLength(1);
    expect(one.elements[0]).toEqual(wall);
    expect(one.objectTypes![0].id).not.toBe(two.objectTypes![0].id);
  });

  it("recomputes quantity and removes empty definitions when instances are removed", () => {
    const grouped = normalizeScanObjects(scan([chair("a"), chair("b")]), "room");
    expect(normalizeScanObjects({ ...grouped, elements: [grouped.elements[1]] }, "room").objectTypes![0].quantity).toBe(1);
    expect(normalizeScanObjects({ ...grouped, elements: [] }, "room").objectTypes).toEqual([]);
  });

  it("hydrates old documents without new fields or usable object dimensions", () => {
    const legacyRoom = room("legacy", [chair("a", { dimensions: undefined as unknown as RoomScanElement["dimensions"], confidence: undefined })]);
    const legacy = { schemaVersion: 1, project: { ...createEmptyProjectDocument({ id: "p", name: "p" }).project, roomCaptures: [legacyRoom] } };
    const reopened = hydrateProjectDocument(JSON.parse(JSON.stringify(legacy)))!;
    const object = reopened.project.roomCaptures[0].roomScan!;
    expect(object.elements).toHaveLength(1);
    expect(object.elements[0].transform).toEqual(legacyRoom.roomScan!.elements[0].transform);
    expect(object.objectTypes![0].boundingVolume).toBeNull();
    expect(object.objectTypes![0].dimensions).toEqual({ width: null, depth: null, height: null, unit: "m" });
  });
});

describe("explicit W × D × H formatting", () => {
  const values = deriveObjectMeasurements({ width: 6, depth: 3.25, height: 2.5, unit: "ft" }, 0.95);
  it("formats feet and squared/cubed units with the requested labels and axis order", () => {
    expect(formatObjectMeasurementDetails(values, "ft")).toBe("W: 6.00 ft\nD: 3.25 ft\nH: 2.50 ft\nFootprint: 19.50 sq ft (W × D)\nFace Area: 15.00 sq ft (W × H)\nVolume: 48.75 cu ft (W × D × H)");
    expect(formatObjectDimensions(values, "in")).toBe("W 72.00 in × D 39.00 in × H 30.00 in");
    expect(formatObjectDimensions(values, "m")).toBe("W 1.83 m × D 0.99 m × H 0.76 m");
    expect(formatObjectDimensions(values, "mm")).toContain("W 1828.80 mm");
    expect(formatMetricPower(1, "cm", 2)).toBe("10000.00 sq cm");
    expect(formatMetricPower(1, "mm", 3)).toBe("1000000000.00 cu mm");
  });
  it("labels missing dimensions and unreliable derived measurements as unknown", () => {
    const values = deriveObjectMeasurements({ width: 1, unit: "m" }, 0.4);
    expect(formatObjectDimensions(values)).toBe("W 1.00 m × D Unknown × H Unknown");
    expect(formatObjectMeasurementDetails(values)).toContain("W: 1.00 m (limited confidence)");
    expect(formatObjectMeasurementDetails(values)).toContain("Volume: Unknown (W × D × H)");
  });
  it("orders live object dimensions independently of event order", () => {
    const values = measurementsForLiveObject([
      { dimension: "height", value: 4, confidence: 0.7, status: "estimating" },
      { dimension: "depth", value: 3, confidence: 0.7, status: "estimating" },
      { dimension: "width", value: 2, confidence: 0.7, status: "estimating" },
    ]);
    expect(formatObjectDimensions(values)).toBe("W 2.00 m × D 3.00 m × H 4.00 m");
    expect(values.boundingVolume).toBe(24);
  });
});
