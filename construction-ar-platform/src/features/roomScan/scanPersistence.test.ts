import { beforeEach, describe, expect, it, vi } from "vitest";
const repository = vi.hoisted(() => ({ loadProjectDocuments: vi.fn(), saveProjectDocuments: vi.fn() }));
vi.mock("../../storage/projectRepository", () => repository);
import { createEmptyProjectDocument } from "../../storage/projectDocument";
import type { RoomCapture } from "../../domain/projects";
import rooms from "../../domain/fixtures/threeRoomAssembly.json";
import { persistCompletedScan, toRoomCapture } from "./scanPersistence";

beforeEach(() => vi.resetAllMocks());
describe("completed scan recovery", () => {
  it("retries with the same room identity and preserves the latest project work and other projects", async () => {
    let documents = [createEmptyProjectDocument({ id: "A", name: "First project" }), createEmptyProjectDocument({ id: "B", name: "Selected project" })];
    const scan = (structuredClone(rooms) as RoomCapture[])[0].roomScan!;
    const room = toRoomCapture(documents[1].project, " Kitchen ", scan, "stable-capture-id");
    repository.loadProjectDocuments.mockImplementation(async () => documents);
    repository.saveProjectDocuments.mockRejectedValueOnce(new Error("Disk full")).mockImplementation(async next => { documents = next; });
    await expect(persistCompletedScan("B", room)).rejects.toThrow("Disk full");
    expect(documents[1].project.roomCaptures).toHaveLength(0);
    documents[1].project.fieldNotes.push({ id: "new-note", text: "Keep this work", createdAt: "2026-10-01" });
    const firstProject = documents[0];
    await persistCompletedScan("B", room);
    await persistCompletedScan("B", room); // Acknowledgement/retry after an already committed save.
    expect(documents[0]).toBe(firstProject);
    expect(documents[1].project.fieldNotes[0].text).toBe("Keep this work");
    expect(documents[1].project.roomCaptures).toHaveLength(1);
    expect(documents[1].project.roomCaptures[0]).toMatchObject({ id: "stable-capture-id", name: "Kitchen", roomScan: { capturedAt: scan.capturedAt } });
    expect(documents[1].scanMeasurementLogEntries).toHaveLength(scan.measurements?.length ?? 0);
    expect(documents[1].project.spatialModel?.roomTransforms[room.id]).toBeDefined();
  });

  it("refuses to report success or write when the destination project is missing", async () => {
    const project = createEmptyProjectDocument({ id: "missing", name: "Missing" }).project;
    const scan = (structuredClone(rooms) as RoomCapture[])[0].roomScan!;
    repository.loadProjectDocuments.mockResolvedValue([]);
    await expect(persistCompletedScan(project.id, toRoomCapture(project, "Room", scan, "capture"))).rejects.toThrow("destination project");
    expect(repository.saveProjectDocuments).not.toHaveBeenCalled();
  });
});
