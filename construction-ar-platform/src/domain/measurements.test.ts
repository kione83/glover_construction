import { describe, expect, it } from "vitest";

import {
  calculateDistanceMeters,
  createMeasurement,
  createMeasurementObservation,
  resolveMeasurementObservations,
} from "./measurements";

function createObservation(id: string, distanceMeters: number) {
  return createMeasurementObservation({
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
      point: { x: distanceMeters, y: 0, z: 0 },
      source: "existing-plane-geometry",
      planeAlignment: "horizontal",
      tracking: { quality: "normal" },
      capturedAt: "2026-08-16T12:00:01.000Z",
    },
  });
}

describe("measurements", () => {
  it("calculates 3D point distance correctly", () => {
    expect(
      calculateDistanceMeters(
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 4, z: 12 },
      ),
    ).toBeCloseTo(13, 10);
  });

  it("keeps tightly grouped observations accepted", () => {
    const resolution = resolveMeasurementObservations([
      createObservation("a", 2.445),
      createObservation("b", 2.446),
      createObservation("c", 2.444),
      createObservation("d", 2.4455),
    ]);

    expect(resolution.acceptedObservations).toHaveLength(4);
    expect(resolution.rejectedObservations).toHaveLength(0);
    expect(resolution.resolvedDistanceMeters).toBeCloseTo(2.44525, 10);
  });

  it("rejects an obvious outlier without overwriting it", () => {
    const resolution = resolveMeasurementObservations([
      createObservation("a", 2.445),
      createObservation("b", 2.446),
      createObservation("c", 2.444),
      createObservation("outlier", 3.1),
    ]);

    expect(resolution.acceptedObservations).toHaveLength(3);
    expect(resolution.rejectedObservations).toHaveLength(1);
    expect(resolution.rejectedObservations[0]?.id).toBe("outlier");
    expect(resolution.rejectedObservations[0]?.status).toBe("rejected");
    expect(resolution.resolvedDistanceMeters).toBeCloseTo(2.445, 10);
  });

  it("supports too-few-observation cases without inventing outlier rejection", () => {
    const resolution = resolveMeasurementObservations([
      createObservation("a", 1.2),
      createObservation("b", 1.24),
    ]);

    expect(resolution.acceptedObservations).toHaveLength(2);
    expect(resolution.rejectedObservations).toHaveLength(0);
    expect(resolution.resolvedDistanceMeters).toBeCloseTo(1.22, 10);
  });

  it("creates a measurement record with preserved raw and resolved values", () => {
    const measurement = createMeasurement({
      id: "measurement-1",
      mode: "multi-capture",
      createdAt: "2026-08-16T12:00:00.000Z",
      observations: [
        createObservation("a", 2.445),
        createObservation("b", 2.446),
        createObservation("c", 2.444),
        createObservation("outlier", 3.1),
      ],
    });

    expect(measurement.rawDistanceMeters).toBeCloseTo(2.445, 10);
    expect(measurement.resolvedDistanceMeters).toBeCloseTo(2.445, 10);
    expect(measurement.acceptedObservationCount).toBe(3);
    expect(measurement.rejectedObservationCount).toBe(1);
    expect(measurement.estimatedUncertainty.status).toBe("uncalibrated");
  });
});
