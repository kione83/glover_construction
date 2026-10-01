import { beforeEach, describe, expect, it, vi } from "vitest";
const repository = vi.hoisted(() => ({ loadProjectDocuments: vi.fn(), saveProjectDocuments: vi.fn() }));
vi.mock("./projectRepository", () => repository);
import { ProjectEditQueue } from "./projectEditQueue";
import { createEmptyProjectDocument, type ProjectDocument } from "./projectDocument";
let documents: ProjectDocument[];
beforeEach(() => {
  vi.resetAllMocks();
  documents = ["A", "B"].map(id => createEmptyProjectDocument({ id, name: id }));
  repository.loadProjectDocuments.mockImplementation(async () => documents);
  repository.saveProjectDocuments.mockImplementation(async next => { documents = next; });
});
const note = (projectId: string, id: string) => (latest: ProjectDocument[]) => latest.map(document => document.project.id === projectId ? { ...document, project: { ...document.project, fieldNotes: [...document.project.fieldNotes, { id, text: id, createdAt: "2026-10-01" }] } } : document);

describe("retryable project edits", () => {
  it("retains failed edits and applies them in order before a later edit", async () => {
    const saved = vi.fn();
    const queue = new ProjectEditQueue(saved);
    repository.saveProjectDocuments.mockRejectedValueOnce(new Error("Storage full"));
    await expect(queue.enqueue(note("B", "first"))).rejects.toThrow("Storage full");
    expect(queue.pendingCount).toBe(1);
    expect(saved).not.toHaveBeenCalled();
    documents[0].project.siteName = "Keep concurrent metadata";
    await queue.enqueue(note("B", "second"));
    expect(documents[1].project.fieldNotes.map(note => note.id)).toEqual(["first", "second"]);
    expect(documents[0].project.siteName).toBe("Keep concurrent metadata");
    expect(queue.pendingCount).toBe(0);
    expect(saved).toHaveBeenCalledTimes(2);
  });
  it("serializes concurrent writes and makes close/retry await all pending operations", async () => {
    const queue = new ProjectEditQueue(() => {});
    let release!: () => void;
    repository.saveProjectDocuments.mockImplementationOnce(async next => {
      await new Promise<void>(resolve => { release = resolve; }); documents = next;
    });
    const first = queue.enqueue(note("B", "first"));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const second = queue.enqueue(note("A", "second"));
    let flushed = false;
    const close = queue.flush().then(() => { flushed = true; });
    expect(flushed).toBe(false);
    expect(repository.saveProjectDocuments).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second, close]);
    expect(documents[0].project.fieldNotes.map(note => note.id)).toEqual(["second"]);
    expect(documents[1].project.fieldNotes.map(note => note.id)).toEqual(["first"]);
    expect(flushed).toBe(true);
  });
  it("keeps failed reads pending and retries against the latest stored documents", async () => {
    const queue = new ProjectEditQueue(() => {});
    repository.loadProjectDocuments.mockRejectedValueOnce(new Error("Read unavailable"));
    await expect(queue.enqueue(note("B", "retained"))).rejects.toThrow("Read unavailable");
    expect(repository.saveProjectDocuments).not.toHaveBeenCalled();
    await queue.flush();
    expect(documents[1].project.fieldNotes[0].id).toBe("retained");
    expect(queue.pendingCount).toBe(0);
  });
});

describe("empty queue boundary", () => {
  it("does not strand an edit enqueued immediately after an empty flush", async () => {
    const queue = new ProjectEditQueue(() => {});
    const empty = queue.flush();
    const edit = queue.enqueue(note("B", "same-tick"));
    await Promise.all([empty, edit]);
    expect(documents[1].project.fieldNotes.map(note => note.id)).toEqual(["same-tick"]);
    expect(queue.pendingCount).toBe(0);
  });
});

describe("save completion boundary", () => {
  it("drains an edit queued by a UI microtask immediately after the preceding write completes", async () => {
    let queued = false;
    let second: Promise<void> | undefined;
    const queue = new ProjectEditQueue(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { second = queue.enqueue(note("B", "after-write")); });
    });
    await queue.enqueue(note("B", "first"));
    await second;
    expect(documents[1].project.fieldNotes.map(note => note.id)).toEqual(["first", "after-write"]);
    expect(queue.pendingCount).toBe(0);
  });
});
