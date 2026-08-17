import { describe, expect, it } from "vitest";

import {
  clearAllMeasurementLogEntries,
  clearRoomMeasurementLogEntries,
  createMeasurement,
  createMeasurementObservation,
  createMultiCaptureMeasurementLogEntry,
  createSingleMeasurementLogEntry,
  deleteMeasurementLogEntry,
  type Measurement,
  type MeasurementObservation,
  type ResolvedMeasurementEndpoint,
} from "../domain";

function makeEndpoint(x: number): ResolvedMeasurementEndpoint {
  return {
    point: { x, y: 0, z: 0 },
    source: "existing-plane-geometry",
    planeAlignment: "horizontal",
    usedFallback: false,
    tracking: {
      quality: "normal",
      localizedState: "normal",
    },
    capturedAt: "2026-08-16T12:00:00.000Z",
  };
}

function makeMeasurement(id: string, inches: number, createdAt: string): Measurement {
  const meters = inches / 39.37007874015748;
  const observation = createMeasurementObservation({
    id: `${id}-observation`,
    startPoint: makeEndpoint(0),
    endPoint: makeEndpoint(meters),
    createdAt,
    deviceMetadata: {
      platform: "ios",
      sensorSummary: "test",
    },
  });

  return createMeasurement({
    id,
    mode: "single",
    observations: [observation],
    createdAt,
    updatedAt: createdAt,
    deviceMetadata: {
      platform: "ios",
      sensorSummary: "test",
    },
  });
}

function resolveMultiCaptureMeasurement(
  observations: MeasurementObservation[],
  createdAt: string,
): Measurement {
  return createMeasurement({
    id: "resolved-multi",
    mode: "multi-capture",
    observations,
    createdAt,
    updatedAt: createdAt,
    deviceMetadata: {
      platform: "ios",
      sensorSummary: "test",
    },
  });
}

describe("measurementLog", () => {
  it("creates room-linked single measurement entries", () => {
    const measurement = makeMeasurement("measurement-1", 23.25, "2026-08-16T12:00:00.000Z");
    const entry = createSingleMeasurementLogEntry({
      id: "entry-1",
      roomCaptureId: "room-kitchen",
      measurement,
      createdAt: "2026-08-16T12:00:00.000Z",
    });

    expect(entry.type).toBe("single");
    expect(entry.roomCaptureId).toBe("room-kitchen");
    expect(entry.measurement.displayDistanceLabel).toBe('23.25"');
  });

  it("creates room-linked multi-capture groups and flags an outlier pass", () => {
    const passes = [
      makeMeasurement("pass-1", 23.25, "2026-08-16T12:00:00.000Z"),
      makeMeasurement("pass-2", 23.5, "2026-08-16T12:00:01.000Z"),
      makeMeasurement("pass-3", 23.25, "2026-08-16T12:00:02.000Z"),
      makeMeasurement("pass-4", 23.5, "2026-08-16T12:00:03.000Z"),
      makeMeasurement("pass-5", 26.5, "2026-08-16T12:00:04.000Z"),
    ];

    const entry = createMultiCaptureMeasurementLogEntry({
      id: "group-1",
      roomCaptureId: "room-kitchen",
      passes,
      createdAt: "2026-08-16T12:00:05.000Z",
      resolveMeasurement: (observations) =>
        resolveMultiCaptureMeasurement(observations, "2026-08-16T12:00:05.000Z"),
    });

    expect(entry.type).toBe("multi-capture");
    expect(entry.roomCaptureId).toBe("room-kitchen");
    expect(entry.passes).toHaveLength(5);
    expect(entry.resolvedMeasurement.displayDistanceLabel).toBe('23.50"');
    expect(entry.resolvedMeasurement.rejectedObservationCount).toBe(1);
    expect(entry.passes.some((pass) => pass.observationStatus === "rejected")).toBe(true);
  });

  it("deletes one measurement without affecting others", () => {
    const first = createSingleMeasurementLogEntry({
      id: "entry-1",
      roomCaptureId: "room-a",
      measurement: makeMeasurement("measurement-1", 23.25, "2026-08-16T12:00:00.000Z"),
      createdAt: "2026-08-16T12:00:00.000Z",
    });
    const second = createSingleMeasurementLogEntry({
      id: "entry-2",
      roomCaptureId: "room-a",
      measurement: makeMeasurement("measurement-2", 24, "2026-08-16T12:01:00.000Z"),
      createdAt: "2026-08-16T12:01:00.000Z",
    });

    const remaining = deleteMeasurementLogEntry([first, second], first.id);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(second.id);
  });

  it("clears one room without affecting other rooms", () => {
    const entryA = createSingleMeasurementLogEntry({
      id: "entry-a",
      roomCaptureId: "room-a",
      measurement: makeMeasurement("measurement-a", 20, "2026-08-16T12:00:00.000Z"),
      createdAt: "2026-08-16T12:00:00.000Z",
    });
    const entryB = createSingleMeasurementLogEntry({
      id: "entry-b",
      roomCaptureId: "room-b",
      measurement: makeMeasurement("measurement-b", 30, "2026-08-16T12:01:00.000Z"),
      createdAt: "2026-08-16T12:01:00.000Z",
    });

    const remaining = clearRoomMeasurementLogEntries([entryA, entryB], "room-a");

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.roomCaptureId).toBe("room-b");
  });

  it("clears all measurement log entries", () => {
    const entry = createSingleMeasurementLogEntry({
      id: "entry-1",
      roomCaptureId: "room-a",
      measurement: makeMeasurement("measurement-a", 20, "2026-08-16T12:00:00.000Z"),
      createdAt: "2026-08-16T12:00:00.000Z",
    });

    expect(clearAllMeasurementLogEntries()).toEqual([]);
    expect(deleteMeasurementLogEntry([entry], entry.id)).toEqual([]);
  });
});
