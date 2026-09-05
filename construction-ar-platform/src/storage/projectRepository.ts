import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import type { Project } from "../domain/projects";
import { hydrateProjectDocument, summarizeProjectScans, summarizeRoomScan, type ProjectDocument } from "./projectDocument";

const PROJECTS_STORAGE_KEY = "construction-ar-platform/projects/v1";
const SCAN_ARCHIVE_DIRECTORY = "construction-ar-platform/scans/";

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
    return archived?.portal?.format === "construction-ar-room-scan" ? archived : scan;
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
      return { ...room, roomScan: await readArchivedScan(room.roomScan) };
    })),
  };
  return { ...document, project };
}

export async function loadProjectDocuments(options: LoadProjectDocumentsOptions = {}): Promise<ProjectDocument[]> {
  const storedValue = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);

  if (!storedValue) {
    return [];
  }

  try {
    const documents: unknown = JSON.parse(storedValue);

    if (!Array.isArray(documents)) {
      return [];
    }

    const hydrated = documents
      .map((document) => hydrateProjectDocument(document))
      .filter((document): document is ProjectDocument => document != null);
    return Promise.all(hydrated.map((document) => hydrateStoredDocument(document, options)));
  } catch {
    return [];
  }
}

export async function saveProjectDocuments(documents: ProjectDocument[]): Promise<void> {
  const preparedDocuments = await Promise.all(documents.map(async (document) => ({
    ...document,
    project: {
      ...document.project,
      roomCaptures: await Promise.all(document.project.roomCaptures.map(async (room) =>
        room.roomScan
          ? { ...room, roomScan: await archiveScan(document.project.id, room.id, room.roomScan) }
          : room,
      )),
    },
  })));
  await AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(preparedDocuments));
  await removeOrphanedScanArchives(preparedDocuments);
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
