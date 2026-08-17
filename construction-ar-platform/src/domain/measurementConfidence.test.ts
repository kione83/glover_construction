import { describe, expect, it } from "vitest";

import { evaluateMeasurementConfidence } from "./measurementConfidence";
import {
  createMeasurementObservation,
  resolveMeasurementObservations,
  type MeasurementObservation,
} from "./measurements";

function makeObservation(
  id: string,
  rawDistanceMetersOffset = 0,
  overrides?: Partial<MeasurementObservation>,
) {
  const observation = createMeasurementObservation({
    id,
    createdAt: "2026-08-16T12:00:00.000Z",
    startPoint: {
      point: { x: 0, y: 0, z: 0 },
      source: "existing-plane-geometry",
      planeAlignment: "horizontal",
      tracking: { quality: "normal" },
      capturedAt: "2026-08-16T12:00:00.000Z",
    },
    endPoint: {
      point: { x: 1 + rawDistanceMetersOffset, y: 0, z: 0 },
      source: "existing-plane-geometry",
      planeAlignment: "horizontal",
      tracking: { quality: "normal" },
      capturedAt: "2026-08-16T12:00:01.000Z",
    },
  });

  return {
    ...observation,
    ...overrides,
  };
}

describe("measurementConfidence", () => {
  it("does not automatically return high confidence for a single stable plane-based capture", () => {
    const resolution = resolveMeasurementObservations([makeObservation("a")]);
    const confidence = evaluateMeasurementConfidence(resolution);

    expect(confidence.level).toBe("low");
    expect(confidence.numericScore).toBeLessThan(0.7);
  });

  it("returns low confidence for feature-point capture with limited tracking", () => {
    const resolution = resolveMeasurementObservations([
      makeObservation("a", 0, {
        startPoint: {
          ...makeObservation("template").startPoint,
          source: "feature-point",
          tracking: { quality: "limited", reason: "insufficient-features" },
        },
        endPoint: {
          ...makeObservation("template").endPoint,
          source: "feature-point",
          tracking: { quality: "limited", reason: "insufficient-features" },
        },
        tracking: { quality: "limited", reason: "insufficient-features" },
      }),
    ]);
    const confidence = evaluateMeasurementConfidence(resolution);

    expect(confidence.level).toBe("low");
    expect(confidence.numericScore).toBeLessThan(0.55);
  });

  it("includes outlier diagnostics when observations disagree", () => {
    const resolution = resolveMeasurementObservations([
      makeObservation("a", 0),
      makeObservation("b", 0.001),
      makeObservation("c", 0.002),
      makeObservation("outlier", 0.3),
    ]);
    const confidence = evaluateMeasurementConfidence(resolution);

    expect(confidence.diagnostics.rejectedObservationCount).toBe(1);
    expect(confidence.reasons.some((reason) => reason.includes("flagged as outliers"))).toBe(true);
  });
});
