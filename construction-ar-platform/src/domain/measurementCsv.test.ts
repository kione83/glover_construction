import { describe, expect, it } from "vitest";

import {
  buildMeasurementCsv,
  buildMeasurementCsvFilename,
  MEASUREMENT_CSV_HEADERS,
  measurementCsvRowCount,
} from "./measurementCsv";
import {
  createMultiCaptureMeasurementLogEntry,
  createSingleMeasurementLogEntry,
} from "./measurementLog";
import {
  createMeasurement,
  createMeasurementObservation,
  type ResolvedMeasurementEndpoint,
} from "./measurements";
import type { Project } from "./projects";

const CREATED_AT = "2026-08-19T13:25:00.000Z";

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function rowByHeader(csv: string, rowIndex = 1): Record<string, string> {
  const rows = parseCsvRows(csv);
  const headers = rows[0] ?? [];
  const row = rows[rowIndex] ?? [];
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function endpoint(
  x: number,
  source: ResolvedMeasurementEndpoint["source"] = "scene-depth",
  diagnostics: ResolvedMeasurementEndpoint["resolutionDiagnostics"] = {
    acceptedSampleCount: 24,
    rejectedSampleCount: 2,
    maximumDeviationMeters: 0.012,
    medianDeviationMeters: 0.004,
    depthMeters: 1.25,
    depthConfidence: 2,
  },
): ResolvedMeasurementEndpoint {
  return {
    point: { x, y: 0, z: 0 },
    source,
    planeAlignment: "unknown",
    usedFallback: false,
    tracking: { quality: "normal" },
    capturedAt: CREATED_AT,
    resolutionDiagnostics: diagnostics,
  };
}

function measurement(id: string, meters: number) {
  return createMeasurement({
    id,
    mode: "single",
    createdAt: CREATED_AT,
    observations: [
      createMeasurementObservation({
        id: `${id}-observation`,
        createdAt: CREATED_AT,
        startPoint: endpoint(0),
        endPoint: endpoint(meters),
      }),
    ],
  });
}

function project(): Pick<Project, "id" | "name" | "roomCaptures"> {
  return {
    id: "project-1",
    name: "Glover, Kitchen",
    roomCaptures: [
      {
        id: "room-1",
        name: "Kitchen \"North\"",
        status: "completed",
        source: "arkit",
        unit: "ft",
        surfaces: [],
      },
    ],
  };
}

describe("measurement CSV export", () => {
  it("creates a clear CSV header row", () => {
    const csv = buildMeasurementCsv([
      createSingleMeasurementLogEntry({
        id: "log-1",
        roomCaptureId: "room-1",
        measurement: measurement("measurement-1", 0.5969),
        createdAt: CREATED_AT,
      }),
    ]);

    expect(csv?.split("\n")[0]).toBe(MEASUREMENT_CSV_HEADERS.join(","));
  });

  it("exports stored measurement values and diagnostics", () => {
    const csv = buildMeasurementCsv(
      [
        createSingleMeasurementLogEntry({
          id: "log-1",
          roomCaptureId: "room-1",
          measurement: measurement("measurement-1", 0.5969),
          createdAt: CREATED_AT,
        }),
      ],
      { project: project() },
    );

    const row = rowByHeader(csv ?? "");
    expect(row.measurementId).toBe("measurement-1");
    expect(row.logEntryId).toBe("log-1");
    expect(row.timestamp).toBe(CREATED_AT);
    expect(row.measurementMetersRaw).toBe("0.5969");
    expect(row.measurementMetersResolved).toBe("0.5969");
    expect(row.measurementDisplayLabel).toBe('23.50"');
    expect(row.pointASource).toBe("scene-depth");
    expect(row.pointBSource).toBe("scene-depth");
    expect(row.pointATrackingState).toBe("normal");
    expect(row.pointBTrackingState).toBe("normal");
    expect(row.pointAAcceptedSampleCount).toBe("24");
    expect(row.pointARejectedSampleCount).toBe("2");
    expect(row.pointBAcceptedSampleCount).toBe("24");
    expect(row.pointBRejectedSampleCount).toBe("2");
    expect(row.pointAMaxDeviationMeters).toBe("0.012");
    expect(row.pointBMaxDeviationMeters).toBe("0.012");
    expect(row.pointAMedianDeviationMeters).toBe("0.004");
    expect(row.pointBMedianDeviationMeters).toBe("0.004");
    expect(row.pointARepresentativeDepthMeters).toBe("1.25");
    expect(row.pointBRepresentativeDepthMeters).toBe("1.25");
    expect(row.pointADepthConfidence).toBe("2");
    expect(row.pointBDepthConfidence).toBe("2");
  });

  it("exports multiple measurement rows including grouped sessions", () => {
    const first = measurement("measurement-1", 0.5969);
    const second = measurement("measurement-2", 0.6);
    const csv = buildMeasurementCsv([
      createSingleMeasurementLogEntry({
        id: "log-1",
        roomCaptureId: "room-1",
        measurement: first,
        createdAt: CREATED_AT,
      }),
      createMultiCaptureMeasurementLogEntry({
        id: "group-1",
        roomCaptureId: "room-1",
        passes: [first, second],
        createdAt: CREATED_AT,
        resolveMeasurement: (observations) =>
          createMeasurement({
            id: "resolved-group",
            mode: "multi-capture",
            observations,
            createdAt: CREATED_AT,
          }),
      }),
    ]);

    const rows = csv?.split("\n") ?? [];
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("measurement-1,log-1,");
    expect(rows[2]).toContain("resolved-group,group-1,group-1");
    expect(rows[2]).toContain(",multi-capture,");
  });

  it("leaves unavailable diagnostic fields empty", () => {
    const startPoint = endpoint(0, "feature-point");
    const endPoint = endpoint(0.25, "feature-point");
    startPoint.resolutionDiagnostics = undefined;
    endPoint.resolutionDiagnostics = undefined;

    const sparse = createMeasurement({
      id: "sparse-measurement",
      mode: "single",
      createdAt: CREATED_AT,
      observations: [
        createMeasurementObservation({
          id: "sparse-observation",
          createdAt: CREATED_AT,
          startPoint,
          endPoint,
        }),
      ],
    });
    const csv = buildMeasurementCsv([
      createSingleMeasurementLogEntry({
        id: "sparse-log",
        roomCaptureId: "room-1",
        measurement: sparse,
        createdAt: CREATED_AT,
      }),
    ]);

    const row = rowByHeader(csv ?? "");
    expect(row.pointASource).toBe("feature-point");
    expect(row.pointBSource).toBe("feature-point");
    expect(row.pointATrackingState).toBe("normal");
    expect(row.pointBTrackingState).toBe("normal");
    expect(row.pointAAcceptedSampleCount).toBe("");
    expect(row.pointARejectedSampleCount).toBe("");
    expect(row.pointBAcceptedSampleCount).toBe("");
    expect(row.pointBRejectedSampleCount).toBe("");
    expect(row.pointAMaxDeviationMeters).toBe("");
    expect(row.pointBMaxDeviationMeters).toBe("");
    expect(row.pointARepresentativeDepthMeters).toBe("");
    expect(row.pointBRepresentativeDepthMeters).toBe("");
  });

  it("escapes quotes, commas, and line breaks", () => {
    const csv = buildMeasurementCsv(
      [
        createSingleMeasurementLogEntry({
          id: "log-1",
          roomCaptureId: "room-1",
          measurement: measurement("measurement-1", 0.5969),
          createdAt: CREATED_AT,
        }),
      ],
      {
        project: {
          id: "project-1",
          name: "Glover, Phase \"A\"\nNorth",
          roomCaptures: [{ ...project().roomCaptures[0], name: "Kitchen, \"North\"" }],
        },
      },
    );

    expect(csv).toContain('"Glover, Phase ""A""\nNorth"');
    expect(csv).toContain('"Kitchen, ""North"""');
  });

  it("generates sanitized timestamped filenames", () => {
    const filename = buildMeasurementCsvFilename({
      room: { id: "room-1", name: "Kitchen / North: Tile" },
      exportedAt: new Date(2026, 7, 19, 13, 25),
    });

    expect(filename).toBe("ConstructionAR_Kitchen_North_Tile_Measurements_2026-08-19_1325.csv");
  });

  it("does not create CSV content for an empty export", () => {
    expect(measurementCsvRowCount([])).toBe(0);
    expect(buildMeasurementCsv([])).toBeNull();
  });
});
