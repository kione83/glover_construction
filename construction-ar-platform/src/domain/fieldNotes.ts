import type { Project, ProjectFieldNote } from "./projects";
export interface FieldNoteInput { text: string; roomCaptureId?: string; placedObjectId?: string }
export function addProjectFieldNote(project: Project, input: FieldNoteInput, id: string, createdAt = new Date().toISOString()): Project {
  const text = input.text.trim();
  if (!text || text.length > 5000) throw new Error("Enter a note between 1 and 5,000 characters.");
  const room = input.roomCaptureId && project.roomCaptures.find(item => item.id === input.roomCaptureId);
  if (input.roomCaptureId && !room) throw new Error("This room is no longer available. Choose another location.");
  const object = input.placedObjectId && project.placedObjects.find(item => item.id === input.placedObjectId && item.status === "active" && item.roomCaptureId === input.roomCaptureId);
  if (input.placedObjectId && !object) throw new Error("This object is no longer available in the selected room.");
  const note: ProjectFieldNote = { id, text, createdAt,
    location: room ? { roomCaptureId: room.id, placedObjectId: object ? object.id : undefined, label: `${room.name}${object ? ` · ${object.displayName}` : ""}` } : undefined,
  };
  return { ...project, fieldNotes: [note, ...project.fieldNotes.filter(item => item.id !== id)] };
}
export function fieldNoteLocation(project: Project, note: ProjectFieldNote): string {
  if (!note.location) return "Project";
  const room = project.roomCaptures.find(item => item.id === note.location!.roomCaptureId);
  if (!room) return `${note.location.label} (room removed)`;
  if (!note.location.placedObjectId) return room.name;
  const object = project.placedObjects.find(item => item.id === note.location!.placedObjectId && item.status === "active");
  return object ? `${room.name} · ${object.displayName}` : `${note.location.label} (object removed)`;
}
