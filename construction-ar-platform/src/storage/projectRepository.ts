import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import type { Project } from "../domain/projects";
import { hydrateProjectDocument, PROJECT_SCHEMA_VERSION, summarizeProjectScans, summarizeRoomScan, type ProjectDocument } from "./projectDocument";
import { normalizeRoomObjects } from "../domain/scannedObjects";
import { normalizeProjectHierarchy } from "../domain/roomObjectHierarchy";

const PROJECTS_STORAGE_KEY = "construction-ar-platform/projects/v1";
const SCAN_ARCHIVE_DIRECTORY = "construction-ar-platform/scans/";
const PROJECT_MEDIA_DIRECTORY = "construction-ar-platform/media/";

export class ProjectStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectStorageError";
  }
}

export interface LoadProjectDocumentsOptions {
  /** Load complete scan archives instead of lightweight project-index entries. */
  includeScans?: boolean;
  /** Restrict archive loading to one project. */
  projectId?: string;
  /** Restrict archive loading to these rooms; useful for single-room viewers. */
  roomIds?: string[];
}

function shouldLoadScan(projectId: string, roomId: string, options: LoadProjectDocumentsOptions): boolean {
  if (!options.includeScans) return false;
  if (options.projectId && options.projectId !== projectId) return false;
  return !options.roomIds || options.roomIds.includes(roomId);
}

async function ensureScanArchiveDirectory(): Promise<string | undefined> {
  const directory = FileSystem.documentDirectory;
  if (!directory) return undefined;
  const archiveDirectory = `${directory}${SCAN_ARCHIVE_DIRECTORY}`;
  const info = await FileSystem.getInfoAsync(archiveDirectory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(archiveDirectory, { intermediates: true });
  return archiveDirectory;
}

async function ensureProjectMediaDirectory(projectId: string): Promise<string> {
  const directory = FileSystem.documentDirectory;
  if (!directory) {
    throw new ProjectStorageError("The app does not have a durable Documents directory available.");
  }

  const mediaDirectory = `${directory}${PROJECT_MEDIA_DIRECTORY}${encodeURIComponent(projectId)}/`;
  const info = await FileSystem.getInfoAsync(mediaDirectory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(mediaDirectory, { intermediates: true });
  return mediaDirectory;
}

function fileExtension(value: string): string {
  const cleanValue = value.split(/[?#]/)[0];
  const match = cleanValue.match(/\.([a-z0-9]{1,8})$/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function isManagedProjectMediaUri(uri: string): boolean {
  return Boolean(FileSystem.documentDirectory && uri.startsWith(`${FileSystem.documentDirectory}${PROJECT_MEDIA_DIRECTORY}`));
}

/** Copy a project photo or blueprint into Documents and return its stable URI. */
export async function persistProjectMedia(
  projectId: string,
  mediaId: string,
  sourceUri: string,
  fileNameHint?: string,
): Promise<string> {
  if (isManagedProjectMediaUri(sourceUri)) return sourceUri;

  const directory = await ensureProjectMediaDirectory(projectId);
  const extension = fileExtension(fileNameHint ?? sourceUri);
  const destination = `${directory}${encodeURIComponent(mediaId)}${extension}`;
  const existing = await FileSystem.getInfoAsync(destination);
  if (!existing.exists) {
    await FileSystem.copyAsync({ from: sourceUri, to: destination });
  }
  return destination;
}

function scanArchiveUri(directory: string, projectId: string, roomId: string): string {
  return `${directory}${encodeURIComponent(projectId)}--${encodeURIComponent(roomId)}.json`;
}

async function archiveScan(projectId: string, roomId: string, scan: NonNullable<ProjectDocument["project"]["roomCaptures"][number]["roomScan"]>): Promise<NonNullable<ProjectDocument["project"]["roomCaptures"][number]["roomScan"]>> {
  const directory = await ensureScanArchiveDirectory();
  if (!directory) return scan;

  // Normal project edits operate on the lightweight index. Never replace a
  // durable full archive with that summary just because another room or field
  // note was changed.
  const hasCompletePayload = Boolean(scan.nativeCapturedRoomJSON || scan.arkitMesh);
  if (scan.archiveUri && !hasCompletePayload) return scan;

  const uri = scanArchiveUri(directory, projectId, roomId);
  const archivedScan = { ...scan, archiveUri: uri };
  const serialized = JSON.stringify(archivedScan);
  await FileSystem.writeAsStringAsync(uri, serialized, { encoding: FileSystem.EncodingType.UTF8 });
  return { ...summarizeRoomScan(archivedScan), archiveUri: uri, archiveSizeBytes: serialized.length };
}

async function readArchivedScan(scan: NonNullable<ProjectDocument["project"]["roomCaptures"][number]["roomScan"]>): Promise<typeof scan> {
  if (!scan.archiveUri) return scan;
  try {
    const info = await FileSystem.getInfoAsync(scan.archiveUri);
    if (!info.exists) return scan;
    const archived = JSON.parse(await FileSystem.readAsStringAsync(scan.archiveUri)) as typeof scan;
    if (archived?.portal?.format !== "construction-ar-room-scan") return scan;
    const overrides = new Map((scan.elements ?? []).filter(element => element.roomLocalTransform).map(element => [element.id, element.roomLocalTransform]));
    return { ...archived, elements: (archived.elements ?? []).map(element => overrides.has(element.id) ? { ...element, roomLocalTransform: overrides.get(element.id) } : element) };
  } catch {
    return scan;
  }
}

async function hydrateStoredDocument(document: ProjectDocument, options: LoadProjectDocumentsOptions): Promise<ProjectDocument> {
  const summaryProject = summarizeProjectScans(document.project);
  const project = {
    ...summaryProject,
    roomCaptures: await Promise.all(summaryProject.roomCaptures.map(async (room) => {
      if (!room.roomScan || !shouldLoadScan(document.project.id, room.id, options)) return room;
      return normalizeRoomObjects({ ...room, roomScan: await readArchivedScan(room.roomScan) });
    })),
  };
  return { ...document, project };
}

export async function loadProjectDocuments(options: LoadProjectDocumentsOptions = {}): Promise<ProjectDocument[]> {
  let storedValue: string | null;
  try {
    storedValue = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);
  } catch {
    throw new ProjectStorageError("Could not read saved projects from device storage.");
  }

  if (!storedValue) {
    return [];
  }

  try {
    const documents: unknown = JSON.parse(storedValue);

    if (!Array.isArray(documents)) {
      throw new ProjectStorageError("Saved project data is invalid and could not be opened.");
    }

    const hydrated = documents
      .map((document) => hydrateProjectDocument(document))
      .filter((document): document is ProjectDocument => document != null);
    return Promise.all(hydrated.map((document) => hydrateStoredDocument(document, options)));
  } catch (error) {
    if (error instanceof ProjectStorageError) throw error;
    throw new ProjectStorageError("Saved project data is corrupted and could not be opened.");
  }
}

export async function saveProjectDocuments(documents: ProjectDocument[]): Promise<void> {
  try {
    const preparedDocuments = await Promise.all(documents.map(async (document) => {
      const project = await persistProjectMediaReferences(normalizeProjectHierarchy(document.project));
      return {
        ...document,
        schemaVersion: Math.max(document.schemaVersion, PROJECT_SCHEMA_VERSION),
        project: {
          ...project,
          roomCaptures: await Promise.all(project.roomCaptures.map(async (room) =>
            room.roomScan
              ? { ...room, roomScan: await archiveScan(project.id, room.id, room.roomScan) }
              : room,
          )),
        },
      };
    }));
    await AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(preparedDocuments));
    await removeOrphanedScanArchives(preparedDocuments);
    await removeOrphanedProjectMedia(preparedDocuments);
  } catch (error) {
    if (error instanceof ProjectStorageError) throw error;
    throw new ProjectStorageError("Could not save project data or its attached files.");
  }
}

async function persistProjectMediaReferences(project: Project): Promise<Project> {
  const [photos, blueprints] = await Promise.all([
    Promise.all(project.photos.map(async (photo) => ({
      ...photo,
      uri: await persistProjectMedia(project.id, photo.id, photo.uri),
    }))),
    Promise.all(project.blueprints.map(async (blueprint) => ({
      ...blueprint,
      uri: await persistProjectMedia(project.id, blueprint.id, blueprint.uri, blueprint.name),
    }))),
  ]);

  return { ...project, photos, blueprints };
}

async function removeOrphanedScanArchives(documents: ProjectDocument[]): Promise<void> {
  const directory = await ensureScanArchiveDirectory();
  if (!directory) return;
  try {
    const referenced = new Set(documents.flatMap((document) => document.project.roomCaptures.flatMap((room) => room.roomScan?.archiveUri ?? [])));
    const entries = await FileSystem.readDirectoryAsync(directory);
    await Promise.all(entries.filter((entry) => entry.endsWith(".json") && !referenced.has(`${directory}${entry}`)).map((entry) => FileSystem.deleteAsync(`${directory}${entry}`, { idempotent: true })));
  } catch {
    // A storage cleanup failure must never make a successfully saved project unavailable.
  }
}

async function removeOrphanedProjectMedia(documents: ProjectDocument[]): Promise<void> {
  const directory = FileSystem.documentDirectory;
  if (!directory) return;

  const mediaDirectory = `${directory}${PROJECT_MEDIA_DIRECTORY}`;
  try {
    const referenced = new Set(
      documents.flatMap((document) => [
        ...document.project.photos.map((photo) => photo.uri),
        ...document.project.blueprints.map((blueprint) => blueprint.uri),
      ]),
    );
    const projectDirectories = await FileSystem.readDirectoryAsync(mediaDirectory);
    await Promise.all(projectDirectories.map(async (projectDirectory) => {
      const projectPath = `${mediaDirectory}${projectDirectory}/`;
      const entries = await FileSystem.readDirectoryAsync(projectPath);
      await Promise.all(entries
        .map((entry) => `${projectPath}${entry}`)
        .filter((uri) => !referenced.has(uri))
        .map((uri) => FileSystem.deleteAsync(uri, { idempotent: true })));
    }));
  } catch {
    // Cleanup is best effort and must not turn a successful project save into a failure.
  }
}

export async function loadProjectScan(projectId: string, roomId: string) {
  const documents = await loadProjectDocuments({ includeScans: true, projectId, roomIds: [roomId] });
  return documents.find((document) => document.project.id === projectId)?.project.roomCaptures.find((room) => room.id === roomId)?.roomScan;
}

export function replaceProject(documents: ProjectDocument[], updatedProject: Project): ProjectDocument[] {
  return documents.map((document) =>
    document.project.id === updatedProject.id
      ? {
          ...document,
          project: updatedProject,
        }
      : document,
  );
}

export function replaceProjectDocument(
  documents: ProjectDocument[],
  updatedDocument: ProjectDocument,
): ProjectDocument[] {
  return documents.map((document) =>
    document.project.id === updatedDocument.project.id ? updatedDocument : document,
  );
}
