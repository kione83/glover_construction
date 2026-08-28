import type {
  MeasurementConfidence,
  MeasurementObservation,
  MeasurementObservationResolution,
  MeasurementTrackingQuality,
  MeasurementTrackingSnapshot,
  ResolvedMeasurementEndpoint,
} from "./measurements";

function scoreTrackingQuality(quality: MeasurementTrackingQuality): number {
  if (quality === "normal") return 1;
  if (quality === "limited") return 0.45;
  return 0;
}

function scoreEndpoint(endpoint: ResolvedMeasurementEndpoint): number {
  if (endpoint.source === "scene-depth") return 1;
  if (endpoint.source === "existing-plane-geometry") return 1;
  if (endpoint.source === "existing-plane-infinite") return 0.8;
  if (endpoint.source === "estimated-plane") return 0.55;
  if (endpoint.source === "feature-point") return 0.25;
  if (endpoint.source === "manual-debug") return 0.15;
  return 0;
}

function weakestTrackingSnapshot(observations: MeasurementObservation[]): MeasurementTrackingSnapshot {
  return observations
    .slice(1)
    .reduce<MeasurementTrackingSnapshot>(
      (weakest, candidate) =>
        scoreTrackingQuality(candidate.tracking.quality) < scoreTrackingQuality(weakest.quality)
          ? candidate.tracking
          : weakest,
      observations[0].tracking,
    );
}

function scoreObservationAgreement(
  resolution: MeasurementObservationResolution,
  referenceDistanceMeters: number,
): number {
  if (resolution.acceptedObservations.length <= 1) {
    return 0.2;
  }

  if (resolution.passAgreementMeters === undefined || referenceDistanceMeters <= Number.EPSILON) {
    return 0.2;
  }

  const relativeSpread = resolution.passAgreementMeters / referenceDistanceMeters;

  if (relativeSpread <= 0.0025) return 1;
  if (relativeSpread <= 0.0075) return 0.8;
  if (relativeSpread <= 0.02) return 0.5;
  return 0.15;
}

export function evaluateMeasurementConfidence(
  resolution: MeasurementObservationResolution,
): MeasurementConfidence {
  const primaryObservation = resolution.primaryObservation;
  const tracking = weakestTrackingSnapshot(resolution.acceptedObservations);
  const endpointScore =
    (scoreEndpoint(primaryObservation.startPoint) + scoreEndpoint(primaryObservation.endPoint)) / 2;
  const trackingScore = scoreTrackingQuality(tracking.quality);
  const agreementScore = scoreObservationAgreement(
    resolution,
    resolution.resolvedDistanceMeters,
  );
  const repeatPassBonus =
    resolution.acceptedObservations.length >= 4
      ? 0.2
      : resolution.acceptedObservations.length >= 3
        ? 0.12
        : resolution.acceptedObservations.length >= 2
          ? 0.04
          : 0;
  const rejectionPenalty = resolution.rejectedObservations.length > 0 ? 0.18 : 0;

  let numericScore = Math.max(
    0,
    Math.min(
      1,
      trackingScore * 0.2
      + endpointScore * 0.2
      + agreementScore * 0.4
      + repeatPassBonus
      - rejectionPenalty,
    ),
  );

  if (resolution.acceptedObservations.length <= 1) {
    numericScore = Math.min(numericScore, 0.69);
  }

  const level =
    numericScore >= 0.8 ? "high" : numericScore >= 0.5 ? "medium" : "low";

  const reasons = [
    `Tracking ${tracking.quality}${tracking.reason ? ` (${tracking.reason})` : ""}.`,
    `Endpoint sources: ${primaryObservation.startPoint.source} and ${primaryObservation.endPoint.source}.`,
  ];

  if (resolution.acceptedObservations.length > 1 && resolution.passAgreementMeters !== undefined) {
    reasons.push(
      `Independent passes agree within ${(resolution.passAgreementMeters * 39.37007874015748).toFixed(2)}".`,
    );
  } else {
    reasons.push("Only one independent measurement pass is available, so confidence is capped.");
  }

  if (resolution.rejectedObservations.length > 0) {
    reasons.push(`${resolution.rejectedObservations.length} pass(es) were flagged as outliers.`);
  }

  reasons.push("Absolute measurement accuracy remains uncalibrated.");

  return {
    level,
    numericScore,
    reasons,
    diagnostics: {
      trackingQuality: tracking.quality,
      trackingReason: tracking.reason,
      endpointA: primaryObservation.startPoint.source,
      endpointB: primaryObservation.endPoint.source,
      acceptedObservationCount: resolution.acceptedObservations.length,
      rejectedObservationCount: resolution.rejectedObservations.length,
      passAgreementMeters: resolution.passAgreementMeters,
      resolutionMethod: resolution.resolutionMethod,
    },
  };
}
