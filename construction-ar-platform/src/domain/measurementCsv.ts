import type { Measurement, ResolvedMeasurementEndpoint } from "./measurements";
import type { MeasurementLogEntry } from "./measurementLog";
import type { Project, RoomCapture } from "./projects";

export interface MeasurementCsvContext {
  project?: Pick<Project, "id" | "name" | "roomCaptures">;
  room?: Pick<RoomCapture, "id" | "name">;
  exportedAt?: Date;
}

interface MeasurementCsvRow {
  measurementId: string;
  logEntryId: string;
  groupSessionId: string;
  timestamp: string;
  projectId: string;
  projectName: string;
  roomCaptureId: string;
  roomName: string;
  measurementMode: string;
  measurementLabel: string;
  measurementMetersRaw: number | string;
  measurementMetersResolved: number | string;
  measurementInchesRaw: number | string;
  measurementInchesResolved: number | string;
  measurementInchesDisplay: number | string;
  measurementDisplayLabel: string;
  confidence: string;
  confidenceScore: number | string;
  measurementMethod: string;
  observationCount: number | string;
  acceptedObservationCount: number | string;
  rejectedObservationCount: number | string;
  groupPassCount: number | string;
  pointASource: string;
  pointBSource: string;
  pointATrackingState: string;
  pointBTrackingState: string;
  pointAAcceptedSampleCount: number | string;
  pointARejectedSampleCount: number | string;
  pointBAcceptedSampleCount: number | string;
  pointBRejectedSampleCount: number | string;
  pointAMaxDeviationMeters: number | string;
  pointBMaxDeviationMeters: number | string;
  pointAMedianDeviationMeters: number | string;
  pointBMedianDeviationMeters: number | string;
  pointARepresentativeDepthMeters: number | string;
  pointBRepresentativeDepthMeters: number | string;
  pointADepthConfidence: number | string;
  pointBDepthConfidence: number | string;
}

export const MEASUREMENT_CSV_HEADERS: Array<keyof MeasurementCsvRow> = [
  "measurementId",
  "logEntryId",
  "groupSessionId",
  "timestamp",
  "projectId",
  "projectName",
  "roomCaptureId",
  "roomName",
  "measurementMode",
  "measurementLabel",
  "measurementMetersRaw",
  "measurementMetersResolved",
  "measurementInchesRaw",
  "measurementInchesResolved",
  "measurementInchesDisplay",
  "measurementDisplayLabel",
  "confidence",
  "confidenceScore",
  "measurementMethod",
  "observationCount",
  "acceptedObservationCount",
  "rejectedObservationCount",
  "groupPassCount",
  "pointASource",
  "pointBSource",
  "pointATrackingState",
  "pointBTrackingState",
  "pointAAcceptedSampleCount",
  "pointARejectedSampleCount",
  "pointBAcceptedSampleCount",
  "pointBRejectedSampleCount",
  "pointAMaxDeviationMeters",
  "pointBMaxDeviationMeters",
  "pointAMedianDeviationMeters",
  "pointBMedianDeviationMeters",
  "pointARepresentativeDepthMeters",
  "pointBRepresentativeDepthMeters",
  "pointADepthConfidence",
  "pointBDepthConfidence",
];

function csvValue(value: number | string | undefined): string {
  if (value === undefined || value === "") {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function endpointAcceptedSamples(endpoint: ResolvedMeasurementEndpoint): number | string {
  return endpoint.resolutionDiagnostics?.acceptedSampleCount ?? "";
}

function endpointRejectedSamples(endpoint: ResolvedMeasurementEndpoint): number | string {
  return endpoint.resolutionDiagnostics?.rejectedSampleCount ?? "";
}

function endpointMaxDeviation(endpoint: ResolvedMeasurementEndpoint): number | string {
  return endpoint.resolutionDiagnostics?.maximumDeviationMeters ?? "";
}

function endpointMedianDeviation(endpoint: ResolvedMeasurementEndpoint): number | string {
  return endpoint.resolutionDiagnostics?.medianDeviationMeters ?? "";
}

function endpointDepth(endpoint: ResolvedMeasurementEndpoint): number | string {
  return endpoint.resolutionDiagnostics?.depthMeters ?? "";
}

function endpointDepthConfidence(endpoint: ResolvedMeasurementEndpoint): number | string {
  return endpoint.resolutionDiagnostics?.depthConfidence ?? "";
}

function roomNameFor(roomCaptureId: string, context: MeasurementCsvContext): string {
  if (context.room?.id === roomCaptureId) {
    return context.room.name;
  }

  return context.project?.roomCaptures.find((room) => room.id === roomCaptureId)?.name ?? "";
}

function rowForMeasurement(
  entry: MeasurementLogEntry,
  measurement: Measurement,
  context: MeasurementCsvContext,
): MeasurementCsvRow {
  const groupSessionId = entry.type === "multi-capture" ? entry.id : "";

  return {
    measurementId: measurement.id,
    logEntryId: entry.id,
    groupSessionId,
    timestamp: measurement.createdAt,
    projectId: context.project?.id ?? "",
    projectName: context.project?.name ?? "",
    roomCaptureId: entry.roomCaptureId,
    roomName: roomNameFor(entry.roomCaptureId, context),
    measurementMode: measurement.mode,
    measurementLabel: "",
    measurementMetersRaw: measurement.rawDistanceMeters,
    measurementMetersResolved: measurement.resolvedDistanceMeters,
    measurementInchesRaw: measurement.rawDistanceInches,
    measurementInchesResolved: measurement.resolvedDistanceInches,
    measurementInchesDisplay: measurement.displayDistanceInches,
    measurementDisplayLabel: measurement.displayDistanceLabel,
    confidence: measurement.confidence.level,
    confidenceScore: measurement.confidence.numericScore,
    measurementMethod: measurement.resolutionMethod,
    observationCount: measurement.observations.length,
    acceptedObservationCount: measurement.acceptedObservationCount,
    rejectedObservationCount: measurement.rejectedObservationCount,
    groupPassCount: entry.type === "multi-capture" ? entry.passes.length : "",
    pointASource: measurement.startPoint.source,
    pointBSource: measurement.endPoint.source,
    pointATrackingState: measurement.startPoint.tracking.quality,
    pointBTrackingState: measurement.endPoint.tracking.quality,
    pointAAcceptedSampleCount: endpointAcceptedSamples(measurement.startPoint),
    pointARejectedSampleCount: endpointRejectedSamples(measurement.startPoint),
    pointBAcceptedSampleCount: endpointAcceptedSamples(measurement.endPoint),
    pointBRejectedSampleCount: endpointRejectedSamples(measurement.endPoint),
    pointAMaxDeviationMeters: endpointMaxDeviation(measurement.startPoint),
    pointBMaxDeviationMeters: endpointMaxDeviation(measurement.endPoint),
    pointAMedianDeviationMeters: endpointMedianDeviation(measurement.startPoint),
    pointBMedianDeviationMeters: endpointMedianDeviation(measurement.endPoint),
    pointARepresentativeDepthMeters: endpointDepth(measurement.startPoint),
    pointBRepresentativeDepthMeters: endpointDepth(measurement.endPoint),
    pointADepthConfidence: endpointDepthConfidence(measurement.startPoint),
    pointBDepthConfidence: endpointDepthConfidence(measurement.endPoint),
  };
}

export function measurementCsvRowCount(entries: MeasurementLogEntry[]): number {
  return entries.length;
}

export function buildMeasurementCsv(
  entries: MeasurementLogEntry[],
  context: MeasurementCsvContext = {},
): string | null {
  if (entries.length === 0) {
    return null;
  }

  const rows = entries.map((entry) =>
    rowForMeasurement(
      entry,
      entry.type === "single" ? entry.measurement : entry.resolvedMeasurement,
      context,
    ),
  );

  return [
    MEASUREMENT_CSV_HEADERS.map(csvValue).join(","),
    ...rows.map((row) => MEASUREMENT_CSV_HEADERS.map((header) => csvValue(row[header])).join(",")),
  ].join("\n");
}

export function sanitizeMeasurementExportFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function buildMeasurementCsvFilename(context: MeasurementCsvContext = {}): string {
  const exportedAt = context.exportedAt ?? new Date();
  const timestamp = [
    exportedAt.getFullYear(),
    String(exportedAt.getMonth() + 1).padStart(2, "0"),
    String(exportedAt.getDate()).padStart(2, "0"),
  ].join("-")
    + "_"
    + String(exportedAt.getHours()).padStart(2, "0")
    + String(exportedAt.getMinutes()).padStart(2, "0");

  const roomName = context.room?.name ? sanitizeMeasurementExportFilenamePart(context.room.name) : "";
  const projectName = context.project?.name
    ? sanitizeMeasurementExportFilenamePart(context.project.name)
    : "";
  const scope = roomName || projectName;

  return scope
    ? `ConstructionAR_${scope}_Measurements_${timestamp}.csv`
    : `ConstructionAR_Measurements_${timestamp}.csv`;
}
