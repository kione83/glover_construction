import { describe, expect, it } from "vitest";

import { createEmptyProjectDocument } from "../storage/projectDocument";
import { buildProjectShareText } from "./projectReport";

describe("buildProjectShareText", () => {
  it("includes the layout, reference, validation, and accuracy disclaimer", () => {
    const project = createEmptyProjectDocument({
      id: "project-1",
      name: "Kitchen Remodel",
      clientName: "Taylor Family",
      blueprints: [{
        id: "blueprint-1",
        name: "Kitchen plan.pdf",
        uri: "file:///tmp/kitchen-plan.pdf",
        mimeType: "application/pdf",
        importedAt: "2026-09-01T12:00:00.000Z",
      }],
    }).project;

    const report = buildProjectShareText(project);

    expect(report).toContain("Project: Kitchen Remodel");
    expect(report).toContain("Kitchen plan.pdf");
    expect(report).toContain("No objects placed");
    expect(report).toContain("not survey-grade");
  });
});
