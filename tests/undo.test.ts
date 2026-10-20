import { describe, expect, it } from 'vitest';
import { UndoStack } from '../src/state/undo';

describe('UndoStack', () => {
  it('supports undo and redo, clearing redo after a new change', () => {
    const stack = new UndoStack<string>();
    stack.push('before');
    expect(stack.undo('after')).toBe('before');
    expect(stack.redo('before')).toBe('after');
    stack.push('new baseline');
    expect(stack.redo('new baseline')).toBeUndefined();
  });

  it('retains at least the most recent 100 actions', () => {
    const stack = new UndoStack<number>(100);
    for (let value = 0; value < 120; value++) stack.push(value);
    expect(stack.undo(120)).toBe(119);
    for (let index = 0; index < 99; index++) stack.undo(index);
    expect(stack.undo(0)).toBeUndefined();
  });
});
