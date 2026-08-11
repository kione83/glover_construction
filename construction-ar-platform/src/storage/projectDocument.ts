import type { Project } from "../domain/projects";

export const PROJECT_DOCUMENT_KIND = "construction-ar-project";
export const PROJECT_SCHEMA_VERSION = 1;

export interface ProjectDocument {
  kind: typeof PROJECT_DOCUMENT_KIND;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  project: Project;
}

export function createEmptyProjectDocument(
  overrides: Partial<Project> & Pick<Project, "id" | "name">,
): ProjectDocument {
  const now = new Date().toISOString();

  return {
    kind: PROJECT_DOCUMENT_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
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
      summary: overrides.summary ?? {
        roomCount: 0,
        placedObjectCount: 0,
        validationIssueCount: 0,
      },
    },
  };
}

export function updateProjectSummary(project: Project): Project {
  return {
    ...project,
    summary: {
      roomCount: project.roomCaptures.length,
      placedObjectCount: project.placedObjects.filter(
        (placedObject) => placedObject.status === "active",
      ).length,
      validationIssueCount: project.validationIssues.length,
      lastValidatedAt:
        project.validationIssues.length > 0
          ? project.validationIssues
              .map((issue) => issue.detectedAt)
              .sort()
              .at(-1)
          : project.summary.lastValidatedAt,
    },
    timestamps: {
      ...project.timestamps,
      updatedAt: new Date().toISOString(),
    },
  };
}
