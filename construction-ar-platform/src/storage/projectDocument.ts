import type { MeasurementLogEntry } from "../domain/measurementLog";
import type { Project } from "../domain/projects";

export const PROJECT_DOCUMENT_KIND = "construction-ar-project";
export const PROJECT_SCHEMA_VERSION = 2;

export interface ProjectDocument {
  kind: typeof PROJECT_DOCUMENT_KIND;
  schemaVersion: number;
  project: Project;
  measurementLogEntries: MeasurementLogEntry[];
}

export function createEmptyProjectDocument(
  overrides: Partial<Project> & Pick<Project, "id" | "name">,
): ProjectDocument {
  const now = new Date().toISOString();

  return {
    kind: PROJECT_DOCUMENT_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    measurementLogEntries: [],
    project: {
      id: overrides.id,
      name: overrides.name,
      clientName: overrides.clientName,
      siteName: overrides.siteName,
      address: overrides.address,
      status: overrides.status ?? "draft",
      targetDevice: overrides.targetDevice ?? "iphone",
      timestamps: {
        createdAt: overrides.timestamps?.createdAt ?? now,
        updatedAt: overrides.timestamps?.updatedAt ?? now,
        lastOpenedAt: overrides.timestamps?.lastOpenedAt,
      },
      roomCaptures: overrides.roomCaptures ?? [],
      anchors: overrides.anchors ?? [],
      placedObjects: overrides.placedObjects ?? [],
      validationIssues: overrides.validationIssues ?? [],
      summary:
        overrides.summary ?? {
          roomCount: 0,
          placedObjectCount: 0,
          validationIssueCount: 0,
          lastValidatedAt: undefined,
        },
    },
  };
}

export function hydrateProjectDocument(document: unknown): ProjectDocument | null {
  if (!document || typeof document !== "object") {
    return null;
  }

  const candidate = document as Partial<ProjectDocument> & { project?: Project };

  if (!candidate.project || typeof candidate.project !== "object") {
    return null;
  }

  return {
    kind: PROJECT_DOCUMENT_KIND,
    schemaVersion:
      typeof candidate.schemaVersion === "number"
        ? candidate.schemaVersion
        : PROJECT_SCHEMA_VERSION,
    project: candidate.project,
    measurementLogEntries: Array.isArray(candidate.measurementLogEntries)
      ? candidate.measurementLogEntries
      : [],
  };
}

export function updateProjectSummary(project: Project): Project {
  const lastValidatedAt =
    project.validationIssues.length > 0
      ? project.validationIssues
          .map((issue) => issue.detectedAt)
          .sort()
          .slice(-1)[0]
      : project.summary.lastValidatedAt;

  return {
    ...project,
    summary: {
      roomCount: project.roomCaptures.length,
      placedObjectCount: project.placedObjects.length,
      validationIssueCount: project.validationIssues.length,
      lastValidatedAt,
    },
    timestamps: {
      ...project.timestamps,
      updatedAt: new Date().toISOString(),
    },
  };
}
