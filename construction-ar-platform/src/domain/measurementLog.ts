import type { Measurement, MeasurementObservation, MeasurementObservationStatus } from "./measurements";

export type MeasurementLogEntryType = "single" | "multi-capture";

export interface SingleMeasurementLogEntry {
  id: string;
  type: "single";
  roomCaptureId: string;
  measurement: Measurement;
  createdAt: string;
  updatedAt: string;
}

export interface MultiCapturePassRecord {
  id: string;
  passNumber: number;
  measurement: Measurement;
  observationStatus: MeasurementObservationStatus;
  deviationFromResolvedInches: number;
}

export interface MultiCaptureMeasurementLogEntry {
  id: string;
  type: "multi-capture";
  roomCaptureId: string;
  passes: MultiCapturePassRecord[];
  resolvedMeasurement: Measurement;
  createdAt: string;
  updatedAt: string;
}

export type MeasurementLogEntry =
  | SingleMeasurementLogEntry
  | MultiCaptureMeasurementLogEntry;

function createObservationFromMeasurement(
  measurement: Measurement,
  observationId: string,
): MeasurementObservation {
  return {
    id: observationId,
    kind: "repeat-pass",
    status: "accepted",
    startPoint: measurement.startPoint,
    endPoint: measurement.endPoint,
    rawDistanceMeters: measurement.rawDistanceMeters,
    tracking: measurement.trackingMetadata,
    createdAt: measurement.createdAt,
    deviceMetadata: measurement.deviceMetadata,
  };
}

export function createSingleMeasurementLogEntry(input: {
  id: string;
  roomCaptureId: string;
  measurement: Measurement;
  createdAt: string;
}): SingleMeasurementLogEntry {
  return {
    id: input.id,
    type: "single",
    roomCaptureId: input.roomCaptureId,
    measurement: input.measurement,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function createMultiCaptureMeasurementLogEntry(input: {
  id: string;
  roomCaptureId: string;
  passes: Measurement[];
  createdAt: string;
  resolveMeasurement: (observations: MeasurementObservation[]) => Measurement;
}): MultiCaptureMeasurementLogEntry {
  const observations = input.passes.map((measurement, index) =>
    createObservationFromMeasurement(measurement, `${input.id}-pass-${index + 1}`),
  );
  const resolvedMeasurement = input.resolveMeasurement(observations);
  const rejectedObservationIds = new Set(
    resolvedMeasurement.observations
      .filter((observation) => observation.status === "rejected")
      .map((observation) => observation.id),
  );

  return {
    id: input.id,
    type: "multi-capture",
    roomCaptureId: input.roomCaptureId,
    passes: input.passes.map((measurement, index) => ({
      id: `${input.id}-pass-record-${index + 1}`,
      passNumber: index + 1,
      measurement,
      observationStatus: rejectedObservationIds.has(`${input.id}-pass-${index + 1}`)
        ? "rejected"
        : "accepted",
      deviationFromResolvedInches:
        measurement.resolvedDistanceInches - resolvedMeasurement.resolvedDistanceInches,
    })),
    resolvedMeasurement,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function deleteMeasurementLogEntry(
  entries: MeasurementLogEntry[],
  entryId: string,
): MeasurementLogEntry[] {
  return entries.filter((entry) => entry.id !== entryId);
}

export function clearRoomMeasurementLogEntries(
  entries: MeasurementLogEntry[],
  roomCaptureId: string,
): MeasurementLogEntry[] {
  return entries.filter((entry) => entry.roomCaptureId !== roomCaptureId);
}

export function clearAllMeasurementLogEntries(): MeasurementLogEntry[] {
  return [];
}
