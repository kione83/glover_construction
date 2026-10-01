import type { ProjectDocument } from "./projectDocument";
import { loadProjectDocuments, saveProjectDocuments } from "./projectRepository";

export type ProjectEdit = (documents: ProjectDocument[]) => ProjectDocument[];

/** Ordered, retryable in-memory edits. A failed write never removes the pending operation. */
export class ProjectEditQueue {
  private pending: ProjectEdit[] = [];
  private running?: Promise<void>;
  constructor(private readonly onSaved: (documents: ProjectDocument[]) => void) {}
  get pendingCount() { return this.pending.length; }

  enqueue(edit: ProjectEdit): Promise<void> {
    this.pending.push(edit);
    return this.flush();
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    if (!this.pending.length) return Promise.resolve();
    const task = this.drain();
    this.running = task.then(() => {
      this.running = undefined;
      // A UI callback may enqueue after drain's final check but before this microtask.
      if (this.pending.length) return this.flush();
    }, error => {
      this.running = undefined;
      throw error;
    });
    return this.running;
  }

  private async drain() {
    while (this.pending.length) {
      const edit = this.pending[0];
      const latest = await loadProjectDocuments();
      const updated = edit(latest);
      await saveProjectDocuments(updated);
      this.pending.shift();
      this.onSaved(updated);
    }
  }
}
