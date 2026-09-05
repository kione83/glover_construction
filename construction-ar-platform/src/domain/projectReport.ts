import type { Project } from "./projects";

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleString() : "Not available";
}

/** A small, human-readable handoff that keeps the MVP's planning limitations explicit. */
export function buildProjectShareText(project: Project): string {
  const activeObjects = project.placedObjects.filter((object) => object.status === "active");
  const issues = project.validationIssues;
  const rooms = project.roomCaptures.map((room) => {
    const scanLabel = room.roomScan ? "RoomPlan scan" : "Manual room";
    const dimensions = room.measuredDimensions
      ? ` - ${room.measuredDimensions.width.toFixed(2)} m × ${room.measuredDimensions.depth.toFixed(2)} m`
      : "";
    return `- ${room.name} (${scanLabel})${dimensions}`;
  });

  return [
    "ConstructionAR layout summary",
    "",
    `Project: ${project.name}`,
    `Client: ${project.clientName ?? "Not specified"}`,
    `Site: ${project.siteName ?? "Not specified"}`,
    `Updated: ${formatDate(project.timestamps.updatedAt)}`,
    "",
    "Rooms",
    ...(rooms.length ? rooms : ["- No rooms saved"]),
    "",
    `Placed objects (${activeObjects.length})`,
    ...(activeObjects.length ? activeObjects.map((object) => `- ${object.displayName}`) : ["- No objects placed"]),
    "",
    `Blueprint references (${project.blueprints.length})`,
    ...(project.blueprints.length ? project.blueprints.map((blueprint) => `- ${blueprint.name}`) : ["- No blueprint imported"]),
    "",
    `Validation: ${issues.length === 0 ? "No issues recorded" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}`,
    ...(issues.length ? issues.map((issue) => `- ${issue.severity.toUpperCase()}: ${issue.message}`) : []),
    "",
    `Site documentation: ${project.photos.length} photo${project.photos.length === 1 ? "" : "s"}, ${project.fieldNotes.length} note${project.fieldNotes.length === 1 ? "" : "s"}`,
    "",
    "Planning visualization only - not survey-grade or engineering-grade measurement.",
  ].join("\n");
}
