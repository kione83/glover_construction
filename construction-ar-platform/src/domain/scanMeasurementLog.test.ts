import { describe, expect, it } from "vitest";

import { buildScanMeasurementCsv, createScanMeasurementLogEntries } from "./scanMeasurementLog";
import type { RoomScanData } from "./projects";

const scan: RoomScanData = {
  version: 1,
  source: "roomplan",
  capturedAt: "2026-08-31T12:00:00.000Z",
  nativeIdentifier: "native-scan-1",
  elements: [],
  measurements: [{
    id: "measurement-wall-width",
    elementId: "wall-1",
    category: "wall",
    dimension: "width",
    label: "Wall length",
    value: 3.42,
    unit: "m",
    status: "estimated",
    initialEstimate: 3.5,
    updatedAt: "2026-08-31T12:00:00.000Z",
    updateCount: 4,
    observationCount: 18,
    confidence: 0.95,
    confidenceSource: "derived",
    source: "roomplan",
    history: [{ timestamp: "2026-08-31T11:59:00.000Z", value: 3.5, observationCount: 1 }],
  }],
  portal: { format: "construction-ar-room-scan", version: 1 },
};

describe("scan measurement logging", () => {
  it("adds project, room, and scan identity to exported estimates", () => {
    const entries = createScanMeasurementLogEntries("project-1", "room-1", scan);
    const csv = buildScanMeasurementCsv(entries);

    expect(entries[0]).toMatchObject({ projectId: "project-1", roomCaptureId: "room-1", scanId: "native-scan-1" });
    expect(csv).toContain("initialEstimate");
    expect(csv).toContain("3.42");
    expect(csv).toContain("native-scan-1");
    expect(csv).toContain("confidenceSource");
    expect(csv).toContain("derived");
  });
});
