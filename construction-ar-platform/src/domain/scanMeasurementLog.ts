import type { RoomScanData, RoomScanMeasurement } from "./projects";

export interface ScanMeasurementLogEntry extends RoomScanMeasurement {
  projectId: string;
  roomCaptureId: string;
  scanId: string;
}

export function createScanMeasurementLogEntries(
  projectId: string,
  roomCaptureId: string,
  scan: RoomScanData,
): ScanMeasurementLogEntry[] {
  return (scan.measurements ?? []).map((measurement) => ({
    ...measurement,
    projectId,
    roomCaptureId,
    scanId: scan.nativeIdentifier ?? roomCaptureId,
  }));
}

export function clearRoomScanMeasurementLogEntries(
  entries: ScanMeasurementLogEntry[],
  roomCaptureId: string,
): ScanMeasurementLogEntry[] {
  return entries.filter((entry) => entry.roomCaptureId !== roomCaptureId);
}

export function clearAllScanMeasurementLogEntries(): ScanMeasurementLogEntry[] {
  return [];
}

function csv(value: string | number | undefined): string {
  if (value === undefined) return "";
  const text = String(value);
  return /[,\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const SCAN_MEASUREMENT_CSV_HEADERS = [
  "projectId", "roomCaptureId", "scanId", "measurementId", "elementId", "wallId", "category",
  "dimension", "label", "value", "unit", "status", "initialEstimate", "updatedAt",
  "updateCount", "observationCount", "confidence", "quality", "rawValue", "valueSource",
  "confidenceSource", "source", "history",
] as const;

export function buildScanMeasurementCsv(entries: ScanMeasurementLogEntry[]): string | null {
  if (entries.length === 0) return null;
  const rows = entries.map((entry) => [
    entry.projectId, entry.roomCaptureId, entry.scanId, entry.id, entry.elementId, entry.wallId,
    entry.category, entry.dimension, entry.label, entry.value, entry.unit, entry.status,
    entry.initialEstimate, entry.updatedAt, entry.updateCount, entry.observationCount,
    entry.confidence, entry.quality, entry.rawValue, entry.valueSource, entry.confidenceSource,
    entry.source, JSON.stringify(entry.history),
  ]);
  return [
    SCAN_MEASUREMENT_CSV_HEADERS.map(csv).join(","),
    ...rows.map((row) => row.map(csv).join(",")),
  ].join("\n");
}
