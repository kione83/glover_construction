import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Project } from "../domain/projects";
import { hydrateProjectDocument, type ProjectDocument } from "./projectDocument";

const PROJECTS_STORAGE_KEY = "construction-ar-platform/projects/v1";

export async function loadProjectDocuments(): Promise<ProjectDocument[]> {
  const storedValue = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);

  if (!storedValue) {
    return [];
  }

  try {
    const documents: unknown = JSON.parse(storedValue);

    if (!Array.isArray(documents)) {
      return [];
    }

    return documents
      .map((document) => hydrateProjectDocument(document))
      .filter((document): document is ProjectDocument => document != null);
  } catch {
    return [];
  }
}

export async function saveProjectDocuments(documents: ProjectDocument[]): Promise<void> {
  await AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(documents));
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
