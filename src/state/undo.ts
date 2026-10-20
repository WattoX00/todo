export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit = 100) {}

  push(snapshot: T): void {
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(current);
    return previous;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
