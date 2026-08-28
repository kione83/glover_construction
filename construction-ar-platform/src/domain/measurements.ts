import type { Vec3 } from "./spatial";

import { evaluateMeasurementConfidence } from "./measurementConfidence";
import {
  formatDecimalInches,
  metersToInches,
  metersToQuarterRoundedDecimalInches,
} from "./measurementUnits";

export type MeasurementType = "distance-between-points";
export type MeasurementMode = "single" | "multi-capture";
export type MeasurementDisplayUnit = "inches-decimal-quarter" | "metric";
export type MeasurementConfidenceLevel = "high" | "medium" | "low";
export type MeasurementObservationStatus = "accepted" | "rejected";
export type MeasurementObservationKind = "single" | "sample-burst" | "repeat-pass";
export type MeasurementTrackingQuality = "normal" | "limited" | "not-available";
export type MeasurementPointSource =
  | "scene-depth"
  | "existing-plane-geometry"
  | "existing-plane-infinite"
  | "estimated-plane"
  | "feature-point"
  | "manual-debug"
  | "unresolved";
export type MeasurementUncertaintyStatus = "available" | "uncalibrated" | "unavailable";
export type MeasurementReticleState = "green" | "yellow" | "red";

export interface MeasurementTrackingSnapshot {
  quality: MeasurementTrackingQuality;
  reason?: string;
  localizedState?: string;
}

export interface DeviceMeasurementMetadata {
  platform: string;
  platformVersion?: string;
  model?: string;
  sensorSummary?: string;
}

export interface MeasurementEndpointResolutionDiagnostics {
  sampleCountCollected?: number;
  acceptedSampleCount?: number;
  rejectedSampleCount?: number;
  maximumDeviationMeters?: number;
  medianDeviationMeters?: number;
  highConfidenceDepthSampleCount?: number;
  sampleWindowSeconds?: number;
  depthConfidence?: number;
  depthMeters?: number;
  sourceCounts?: Partial<Record<MeasurementPointSource, number>>;
  reticleState?: MeasurementReticleState;
}

export interface ResolvedMeasurementEndpoint {
  point: Vec3;
  source: MeasurementPointSource;
  planeAlignment?: "horizontal" | "vertical" | "slanted" | "unknown";
  usedFallback?: boolean;
  tracking: MeasurementTrackingSnapshot;
  capturedAt: string;
  resolutionDiagnostics?: MeasurementEndpointResolutionDiagnostics;
}

export interface MeasurementObservation {
  id: string;
  kind: MeasurementObservationKind;
  status: MeasurementObservationStatus;
  rejectionReason?: string;
  startPoint: ResolvedMeasurementEndpoint;
  endPoint: ResolvedMeasurementEndpoint;
  rawDistanceMeters: number;
  tracking: MeasurementTrackingSnapshot;
  createdAt: string;
  deviceMetadata?: DeviceMeasurementMetadata;
}

export interface MeasurementConfidenceDiagnostics {
  trackingQuality: MeasurementTrackingQuality;
  trackingReason?: string;
  endpointA: MeasurementPointSource;
  endpointB: MeasurementPointSource;
  acceptedObservationCount: number;
  rejectedObservationCount: number;
  passAgreementMeters?: number;
  resolutionMethod: MeasurementResolutionMethod;
}

export interface MeasurementConfidence {
  level: MeasurementConfidenceLevel;
  numericScore: number;
  reasons: string[];
  diagnostics: MeasurementConfidenceDiagnostics;
}

export interface MeasurementEstimatedUncertainty {
  status: MeasurementUncertaintyStatus;
  meters?: number;
  note: string;
}

export type MeasurementResolutionMethod =
  | "single-observation"
  | "median"
  | "median-with-mad-outlier-rejection";

export interface MeasurementObservationResolution {
  resolutionMethod: MeasurementResolutionMethod;
  resolvedDistanceMeters: number;
  rawDistanceMeters: number;
  acceptedObservations: MeasurementObservation[];
  rejectedObservations: MeasurementObservation[];
  observations: MeasurementObservation[];
  primaryObservation: MeasurementObservation;
  passAgreementMeters?: number;
  medianAbsoluteDeviationMeters?: number;
}

export interface Measurement {
  id: string;
  type: MeasurementType;
  mode: MeasurementMode;
  startPoint: ResolvedMeasurementEndpoint;
  endPoint: ResolvedMeasurementEndpoint;
  rawDistanceMeters: number;
  resolvedDistanceMeters: number;
  rawDistanceInches: number;
  resolvedDistanceInches: number;
  displayDistanceInches: number;
  displayDistanceLabel: string;
  displayUnit: MeasurementDisplayUnit;
  confidence: MeasurementConfidence;
  estimatedUncertainty: MeasurementEstimatedUncertainty;
  observations: MeasurementObservation[];
  acceptedObservationCount: number;
  rejectedObservationCount: number;
  deviceMetadata?: DeviceMeasurementMetadata;
  trackingMetadata: MeasurementTrackingSnapshot;
  createdAt: string;
  updatedAt: string;
  observationSpreadMeters?: number;
  resolutionMethod: MeasurementResolutionMethod;
}

export function calculateDistanceMeters(startPoint: Vec3, endPoint: Vec3): number {
  const x = endPoint.x - startPoint.x;
  const y = endPoint.y - startPoint.y;
  const z = endPoint.z - startPoint.z;

  return Math.sqrt(x * x + y * y + z * z);
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
  }

  return sorted[middleIndex];
}

function cloneObservation(
  observation: MeasurementObservation,
  status: MeasurementObservationStatus,
  rejectionReason?: string,
): MeasurementObservation {
  return {
    ...observation,
    status,
    rejectionReason,
  };
}

function identifyOutlierIds(observations: MeasurementObservation[]): Set<string> {
  if (observations.length < 3) {
    return new Set();
  }

  const center = median(observations.map((observation) => observation.rawDistanceMeters));
  const absoluteDeviations = observations.map((observation) =>
    Math.abs(observation.rawDistanceMeters - center));
  const medianAbsoluteDeviation = median(absoluteDeviations);

  if (medianAbsoluteDeviation <= Number.EPSILON) {
    return new Set();
  }

  return new Set(
    observations
      .filter((observation) => {
        const modifiedZScore =
          0.6745 * (observation.rawDistanceMeters - center) / medianAbsoluteDeviation;

        return Math.abs(modifiedZScore) > 3.5;
      })
      .map((observation) => observation.id),
  );
}

export function resolveMeasurementObservations(
  observations: MeasurementObservation[],
): MeasurementObservationResolution {
  if (observations.length === 0) {
    throw new Error("At least one measurement observation is required.");
  }

  const rejectedOutlierIds = identifyOutlierIds(observations);
  const acceptedObservations = observations
    .filter((observation) => !rejectedOutlierIds.has(observation.id))
    .map((observation) => cloneObservation(observation, "accepted"));
  const rejectedObservations = observations
    .filter((observation) => rejectedOutlierIds.has(observation.id))
    .map((observation) =>
      cloneObservation(observation, "rejected", "Rejected by robust outlier screening."),
    );

  const effectiveAcceptedObservations =
    acceptedObservations.length > 0
      ? acceptedObservations
      : [cloneObservation(observations[0], "accepted")];
  const acceptedDistances = effectiveAcceptedObservations.map((observation) => observation.rawDistanceMeters);
  const resolvedDistanceMeters = median(acceptedDistances);
  const primaryObservation = [...effectiveAcceptedObservations].sort((first, second) =>
    Math.abs(first.rawDistanceMeters - resolvedDistanceMeters)
    - Math.abs(second.rawDistanceMeters - resolvedDistanceMeters))[0];

  const sortedAcceptedDistances = [...acceptedDistances].sort((first, second) => first - second);
  const passAgreementMeters =
    sortedAcceptedDistances.length > 1
      ? sortedAcceptedDistances[sortedAcceptedDistances.length - 1] - sortedAcceptedDistances[0]
      : undefined;
  const medianAbsoluteDeviationMeters =
    effectiveAcceptedObservations.length > 1
      ? median(
        effectiveAcceptedObservations.map((observation) =>
          Math.abs(observation.rawDistanceMeters - resolvedDistanceMeters)),
      )
      : undefined;

  const resolutionMethod =
    effectiveAcceptedObservations.length === 1
      ? "single-observation"
      : rejectedObservations.length > 0
        ? "median-with-mad-outlier-rejection"
        : "median";

  return {
    resolutionMethod,
    resolvedDistanceMeters,
    rawDistanceMeters: primaryObservation.rawDistanceMeters,
    acceptedObservations: effectiveAcceptedObservations,
    rejectedObservations,
    observations: [...effectiveAcceptedObservations, ...rejectedObservations],
    primaryObservation,
    passAgreementMeters,
    medianAbsoluteDeviationMeters,
  };
}

function deriveEstimatedUncertainty(
  resolution: MeasurementObservationResolution,
): MeasurementEstimatedUncertainty {
  if (resolution.acceptedObservations.length > 1 && resolution.passAgreementMeters !== undefined) {
    return {
      status: "uncalibrated",
      note:
        "Pass agreement is available, but absolute measurement uncertainty is not yet calibrated against ground truth.",
    };
  }

  return {
    status: "uncalibrated",
    note:
      "Absolute measurement uncertainty is not yet calibrated for this device and acquisition path.",
  };
}

export function createMeasurementObservation(input: {
  id: string;
  kind?: MeasurementObservationKind;
  startPoint: ResolvedMeasurementEndpoint;
  endPoint: ResolvedMeasurementEndpoint;
  createdAt: string;
  deviceMetadata?: DeviceMeasurementMetadata;
}): MeasurementObservation {
  const rawDistanceMeters = calculateDistanceMeters(
    input.startPoint.point,
    input.endPoint.point,
  );

  const tracking =
    input.startPoint.tracking.quality === "not-available"
      || input.endPoint.tracking.quality === "not-available"
      ? input.startPoint.tracking.quality === "not-available"
        ? input.startPoint.tracking
        : input.endPoint.tracking
      : input.startPoint.tracking.quality === "limited"
        || input.endPoint.tracking.quality === "limited"
        ? input.startPoint.tracking.quality === "limited"
          ? input.startPoint.tracking
          : input.endPoint.tracking
        : input.startPoint.tracking;

  return {
    id: input.id,
    kind: input.kind ?? "single",
    status: "accepted",
    startPoint: input.startPoint,
    endPoint: input.endPoint,
    rawDistanceMeters,
    tracking,
    createdAt: input.createdAt,
    deviceMetadata: input.deviceMetadata,
  };
}

export function createMeasurement(input: {
  id: string;
  mode: MeasurementMode;
  observations: MeasurementObservation[];
  displayUnit?: MeasurementDisplayUnit;
  createdAt: string;
  updatedAt?: string;
  deviceMetadata?: DeviceMeasurementMetadata;
}): Measurement {
  const resolution = resolveMeasurementObservations(input.observations);
  const confidence = evaluateMeasurementConfidence(resolution);
  const rawDistanceInches = metersToInches(resolution.rawDistanceMeters);
  const resolvedDistanceInches = metersToInches(resolution.resolvedDistanceMeters);
  const displayDistanceInches = metersToQuarterRoundedDecimalInches(
    resolution.resolvedDistanceMeters,
  );

  return {
    id: input.id,
    type: "distance-between-points",
    mode: input.mode,
    startPoint: resolution.primaryObservation.startPoint,
    endPoint: resolution.primaryObservation.endPoint,
    rawDistanceMeters: resolution.rawDistanceMeters,
    resolvedDistanceMeters: resolution.resolvedDistanceMeters,
    rawDistanceInches,
    resolvedDistanceInches,
    displayDistanceInches,
    displayDistanceLabel: formatDecimalInches(displayDistanceInches),
    displayUnit: input.displayUnit ?? "inches-decimal-quarter",
    confidence,
    estimatedUncertainty: deriveEstimatedUncertainty(resolution),
    observations: resolution.observations,
    acceptedObservationCount: resolution.acceptedObservations.length,
    rejectedObservationCount: resolution.rejectedObservations.length,
    deviceMetadata: input.deviceMetadata ?? resolution.primaryObservation.deviceMetadata,
    trackingMetadata: resolution.primaryObservation.tracking,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    observationSpreadMeters: resolution.passAgreementMeters,
    resolutionMethod: resolution.resolutionMethod,
  };
}
