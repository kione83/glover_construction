import { describe, expect, it } from "vitest";
import { createEmptyProjectDocument } from "../storage/projectDocument";
import { addProjectFieldNote, fieldNoteLocation } from "./fieldNotes";
import { identityTransform, removeRoomFromProject } from "./projects";
const base = () => createEmptyProjectDocument({ id: "p", name: "Notes", roomCaptures: [{ id: "room", name: "Kitchen", source: "manual", status: "completed", unit: "m", surfaces: [] }], placedObjects: [{ id: "outlet", catalogObjectId: "electrical-outlet-duplex", roomCaptureId: "room", anchorId: "a", displayName: "Outlet", transform: identityTransform(), dimensions: { width: 0.08, height: 0.12, depth: 0.04, unit: "m" }, status: "active", placedAt: "today", updatedAt: "today" }] }).project;
describe("project field notes", () => {
  it("stores project, room and object notes with durable location labels", () => {
    let project = addProjectFieldNote(base(), { text: "Project note" }, "project-note");
    project = addProjectFieldNote(project, { text: " Room note ", roomCaptureId: "room" }, "room-note");
    project = addProjectFieldNote(project, { text: "Move before installation", roomCaptureId: "room", placedObjectId: "outlet" }, "object-note");
    expect(project.fieldNotes.map(note => fieldNoteLocation(project, note))).toEqual(["Kitchen · Outlet", "Kitchen", "Project"]);
    const reopened = JSON.parse(JSON.stringify(project));
    expect(reopened.fieldNotes[0].location).toMatchObject({ roomCaptureId: "room", placedObjectId: "outlet" });
    const removed = removeRoomFromProject(reopened, "room");
    expect(fieldNoteLocation(removed, removed.fieldNotes[0])).toBe("Kitchen · Outlet (room removed)");
    expect(removed.fieldNotes).toHaveLength(3);
  });
  it("validates content and associations and treats retries as an idempotent write", () => {
    expect(() => addProjectFieldNote(base(), { text: " " }, "n")).toThrow("Enter a note");
    expect(() => addProjectFieldNote(base(), { text: "x".repeat(5001) }, "n")).toThrow("5,000");
    expect(() => addProjectFieldNote(base(), { text: "x", roomCaptureId: "missing" }, "n")).toThrow("room");
    expect(() => addProjectFieldNote(base(), { text: "x", placedObjectId: "outlet" }, "n")).toThrow("object");
    const project = addProjectFieldNote(base(), { text: "x" }, "n");
    expect(addProjectFieldNote(project, { text: "x" }, "n").fieldNotes).toHaveLength(1);
  });
});
