export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private grouping = false;
  private grouped = false;
  private limit: number;
  constructor(limit = 100) {
    this.limit = limit;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  begin() {
    this.grouping = true;
    this.grouped = false;
  }
  end() {
    this.grouping = false;
    this.grouped = false;
  }
  commit(before: T, after: T) {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    if (!this.grouping || !this.grouped) {
      this.past.push(before);
      if (this.past.length > this.limit) this.past.shift();
    }
    if (this.grouping) this.grouped = true;
    this.future = [];
    return true;
  }
  undo(current: T) {
    this.end();
    if (!this.canUndo) return null;
    this.future.push(current);
    return this.past.pop()!;
  }
  redo(current: T) {
    this.end();
    if (!this.canRedo) return null;
    this.past.push(current);
    return this.future.pop()!;
  }
}
