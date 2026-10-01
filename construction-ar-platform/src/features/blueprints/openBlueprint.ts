import { NativeModules, Platform } from "react-native";
import type { ProjectBlueprintReference } from "../../domain/projects";

/** Opens the durable project copy; no upload, temporary conversion or network is required. */
export async function openBlueprint(blueprint: ProjectBlueprintReference): Promise<void> {
  const preview = NativeModules.ProjectDocumentPreview;
  if (Platform.OS !== "ios" || !preview?.openDocument) {
    throw new Error("Plan preview requires the updated iOS app. The imported file remains saved in this project.");
  }
  await preview.openDocument(blueprint.uri, blueprint.name);
}
