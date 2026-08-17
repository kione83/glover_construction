import { describe, expect, it } from "vitest";

import { createEmptyProjectDocument, hydrateProjectDocument } from "./projectDocument";

describe("projectDocument", () => {
  it("creates empty project documents with an empty measurement log", () => {
    const document = createEmptyProjectDocument({
      id: "project-1",
      name: "Kitchen Remodel",
    });

    expect(document.schemaVersion).toBe(2);
    expect(document.measurementLogEntries).toEqual([]);
  });

  it("hydrates older saved documents that do not yet contain measurement logs", () => {
    const hydrated = hydrateProjectDocument({
      kind: "construction-ar-project",
      schemaVersion: 1,
      project: createEmptyProjectDocument({
        id: "project-1",
        name: "Kitchen Remodel",
      }).project,
    });

    expect(hydrated).not.toBeNull();
    expect(hydrated?.measurementLogEntries).toEqual([]);
  });
});
