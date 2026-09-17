import type { Dimensions3D, LengthUnit } from "./spatial";
import type { RoomCapture, RoomScanData, RoomScanElement, RoomScanMeasurement, ScannedObjectMeasurements, ScannedObjectType } from "./projects";
import { formatMetricPower, METERS_PER_LENGTH_UNIT } from "./measurementUnits";
import { canonicalTransform, capturedTransform } from "./spatialTransforms";

export const OBJECT_DIMENSION_AXES = ["width", "depth", "height"] as const;
export const OBJECT_DIMENSION_LABELS = { width: "W", depth: "D", height: "H" } as const;
/** Both limits apply, on every axis and against every member (no chain merging). */
export const OBJECT_GROUP_TOLERANCE = { absoluteMeters: 0.02, relative: 0.03 } as const;
/** Matches the native RoomPlan limited-quality boundary (low=.4, medium=.7, high=.95). */
export const OBJECT_MIN_CONFIDENCE = 0.6;

type MeasurementEvidence = Pick<RoomScanMeasurement, "dimension" | "value" | "confidence" | "quality" | "status">;

export function isScannedObject(element: Pick<RoomScanElement, "kind">): boolean {
  return ["furniture", "built-in", "fixture"].includes(element.kind);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function confidenceStatus(value: number | undefined): "estimated" | "limited" | "unknown" {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) return "unknown";
  return value >= OBJECT_MIN_CONFIDENCE ? "estimated" : "limited";
}

/** Geometry is authoritative; measurement history supplies quality, never rotated bounds. */
export function deriveObjectMeasurements(
  geometry: Partial<Dimensions3D> | undefined,
  confidence?: number,
  evidence: readonly MeasurementEvidence[] = [],
): ScannedObjectMeasurements {
  const dimensions: ScannedObjectMeasurements["dimensions"] = { width: null, depth: null, height: null, unit: "m" };
  const dimensionStatus: ScannedObjectMeasurements["dimensionStatus"] = { width: "unknown", depth: "unknown", height: "unknown" };
  const factor = geometry?.unit ? METERS_PER_LENGTH_UNIT[geometry.unit] : undefined;
  for (const axis of OBJECT_DIMENSION_AXES) {
    const raw = geometry?.[axis];
    if (!positive(raw) || !positive(factor) || !positive(raw * factor)) continue;
    dimensions[axis] = raw * factor;
    const observations = evidence.filter(item => item.dimension === axis);
    const statuses = [confidenceStatus(confidence), ...observations.map(item => confidenceStatus(item.confidence))];
    dimensionStatus[axis] = observations.some(item => item.quality === "limited" || item.status === "limited") || statuses.includes("limited")
      ? "limited"
      : statuses.includes("estimated") ? "estimated" : "unknown";
  }
  const product = (...axes: (typeof OBJECT_DIMENSION_AXES[number])[]): number | null => {
    if (axes.some(axis => dimensions[axis] === null || dimensionStatus[axis] !== "estimated")) return null;
    const value = axes.reduce((result, axis) => result * dimensions[axis]!, 1);
    return positive(value) ? value : null;
  };
  return { dimensions, dimensionStatus, footprintArea: product("width", "depth"), faceArea: product("width", "height"), boundingVolume: product("width", "depth", "height") };
}

export function measurementsForScannedObject(element: RoomScanElement, scan: RoomScanData): ScannedObjectMeasurements {
  return deriveObjectMeasurements(element.dimensions, element.confidence, (scan.measurements ?? []).filter(item => item.elementId === element.id));
}

/** Live estimates have no durable instance until the final RoomPlan geometry arrives. */
export function measurementsForLiveObject(values: readonly MeasurementEvidence[]): ScannedObjectMeasurements {
  const dimensions: Partial<Dimensions3D> = { unit: "m" };
  for (const axis of OBJECT_DIMENSION_AXES) dimensions[axis] = values.find(item => item.dimension === axis)?.value;
  return deriveObjectMeasurements(dimensions, undefined, values);
}

function knownCategory(category: string): boolean {
  return !!category && !["unknown", "other", "object", "generic-object", "unrecognized"].includes(category);
}

function similar(a: ScannedObjectMeasurements, b: ScannedObjectMeasurements): boolean {
  return OBJECT_DIMENSION_AXES.every(axis => {
    const x = a.dimensions[axis], y = b.dimensions[axis];
    if (x === null || y === null || a.dimensionStatus[axis] !== "estimated" || b.dimensionStatus[axis] !== "estimated") return false;
    const tolerance = Math.min(OBJECT_GROUP_TOLERANCE.absoluteMeters, OBJECT_GROUP_TOLERANCE.relative * Math.min(x, y));
    return Math.abs(x - y) <= tolerance + 1e-9;
  });
}

/**
 * Add shared definitions without dropping/reordering geometry or changing transforms.
 * Existing elements ARE the instances; no second array of positions is introduced.
 * Sorting only the grouping candidates makes definitions deterministic on reload.
 */
export function normalizeScanObjects(scan: RoomScanData, roomCaptureId: string): RoomScanData {
  const groups: { type: ScannedObjectType; members: ScannedObjectMeasurements[] }[] = [];
  const references = new Map<string, string>();
  for (const element of [...(scan.elements ?? [])].filter(isScannedObject).sort((a, b) => a.id.localeCompare(b.id))) {
    const category = (element.category ?? "unknown").trim().toLowerCase();
    const measurements = measurementsForScannedObject(element, scan);
    let group = knownCategory(category) ? groups.find(candidate =>
      candidate.type.category === category && candidate.type.kind === element.kind && candidate.type.representation === element.representation &&
      candidate.members.every(member => similar(member, measurements)),
    ) : undefined;
    if (!group) {
      group = { type: {
        id: `object-type:${encodeURIComponent(roomCaptureId)}:${encodeURIComponent(element.id)}`,
        roomCaptureId, category, kind: element.kind, representation: element.representation,
        representativeInstanceId: element.id, quantity: 0, ...measurements,
      }, members: [] };
      groups.push(group);
    }
    group.type.quantity += 1;
    group.members.push(measurements);
    references.set(element.id, group.type.id);
  }
  return {
    ...scan,
    objectMetadataVersion: 1,
    objectTypes: groups.map(group => group.type),
    elements: (scan.elements ?? []).map(element => isScannedObject(element)
      ? { ...element, roomCaptureId, objectTypeId: references.get(element.id), roomLocalTransform: element.roomLocalTransform ? canonicalTransform(element.roomLocalTransform) : capturedTransform(element.transform) }
      : element),
  };
}

export function normalizeRoomObjects(room: RoomCapture): RoomCapture {
  return room.roomScan ? { ...room, roomScan: normalizeScanObjects(room.roomScan, room.id) } : room;
}

export function formatObjectDimensions(measurements: ScannedObjectMeasurements, unit: LengthUnit = "m"): string {
  return OBJECT_DIMENSION_AXES.map(axis => `${OBJECT_DIMENSION_LABELS[axis]} ${formatMetricPower(measurements.dimensions[axis], unit, 1)}`).join(" × ");
}

export function formatObjectMeasurementDetails(measurements: ScannedObjectMeasurements, unit: LengthUnit = "m"): string {
  const axes = OBJECT_DIMENSION_AXES.map(axis => {
    const status = measurements.dimensionStatus[axis];
    const suffix = measurements.dimensions[axis] !== null && status !== "estimated" ? ` (${status === "limited" ? "limited confidence" : "confidence unknown"})` : "";
    return `${OBJECT_DIMENSION_LABELS[axis]}: ${formatMetricPower(measurements.dimensions[axis], unit, 1)}${suffix}`;
  });
  return [...axes,
    `Footprint: ${formatMetricPower(measurements.footprintArea, unit, 2)} (W × D)`,
    `Face Area: ${formatMetricPower(measurements.faceArea, unit, 2)} (W × H)`,
    `Volume: ${formatMetricPower(measurements.boundingVolume, unit, 3)} (W × D × H)`,
  ].join("\n");
}
