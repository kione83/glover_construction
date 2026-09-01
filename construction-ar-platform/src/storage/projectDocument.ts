import type { MeasurementLogEntry } from "../domain/measurementLog";
import type { Project } from "../domain/projects";
import type { ScanMeasurementLogEntry } from "../domain/scanMeasurementLog";

export const PROJECT_DOCUMENT_KIND = "construction-ar-project";
export const PROJECT_SCHEMA_VERSION = 5;

export interface ProjectDocument {
  kind: typeof PROJECT_DOCUMENT_KIND;
  schemaVersion: number;
  project: Project;
  measurementLogEntries: MeasurementLogEntry[];
  scanMeasurementLogEntries: ScanMeasurementLogEntry[];
}

export function createEmptyProjectDocument(
  overrides: Partial<Project> & Pick<Project, "id" | "name">,
): ProjectDocument {
  const now = new Date().toISOString();

  return {
    kind: PROJECT_DOCUMENT_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    measurementLogEntries: [],
    scanMeasurementLogEntries: [],
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
      photos: overrides.photos ?? [],
      fieldNotes: overrides.fieldNotes ?? [],
      spatialModel: overrides.spatialModel ?? {
        coordinateSystem: "project-local",
        roomTransforms: {},
        connections: [],
      },
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
        ? Math.max(candidate.schemaVersion, PROJECT_SCHEMA_VERSION)
        : PROJECT_SCHEMA_VERSION,
    project: {
      ...candidate.project,
      photos: candidate.project.photos ?? [],
      fieldNotes: candidate.project.fieldNotes ?? [],
      spatialModel: candidate.project.spatialModel ?? {
        coordinateSystem: "project-local",
        roomTransforms: Object.fromEntries(
          (candidate.project.roomCaptures ?? []).map((room) => [room.id, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { pitch: 0, yaw: 0, roll: 0 },
            scale: { x: 1, y: 1, z: 1 },
          }]),
        ),
        connections: [],
      },
    },
    measurementLogEntries: Array.isArray(candidate.measurementLogEntries)
      ? candidate.measurementLogEntries
      : [],
    scanMeasurementLogEntries: Array.isArray(candidate.scanMeasurementLogEntries)
      ? candidate.scanMeasurementLogEntries
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
