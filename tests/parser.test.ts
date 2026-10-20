import { describe, expect, it } from 'vitest';
import { mergeLines, parseList, serializeList, shareText } from '../src/model/parser';

describe('plain-text list format', () => {
  it('round-trips todos, notes, pinning, and UTF-8 text with a trailing newline', () => {
    const input = '# Café 🥐\n\n* [ ] 東京の買い物\n- [x] Milk\nA preserved note\n';
    const parsed = parseList(input);
    expect(serializeList(parsed)).toBe(input);
    expect(parsed.lines).toHaveLength(3);
  });

  it('normalizes CRLF input without dropping unknown lines', () => {
    const parsed = parseList('# Work\r\n\r\n- [ ] Ship\r\n> keep this\r\n');
    expect(parsed.title).toBe('Work');
    expect(serializeList(parsed)).toBe('# Work\n\n- [ ] Ship\n> keep this\n');
  });

  it('handles empty files and empty todo lists', () => {
    expect(parseList('').lines).toEqual([]);
    expect(serializeList(parseList('# Empty\n\n'))).toBe('# Empty\n\n');
    expect(serializeList(parseList('# Empty\n\n- [ ]\n'))).toBe('# Empty\n\n- [ ]\n');
  });

  it('exports pinned todos first without application markers', () => {
    const parsed = parseList('# Groceries\n\n- [ ] Milk\n* [x] Eggs\n* [ ] Bread\n');
    expect(shareText(parsed)).toBe('Groceries\n\n[x] Eggs\n[ ] Bread\n[ ] Milk');
    expect(shareText(parsed, parsed.lines[1]?.kind === 'todo' ? parsed.lines[1].todo.id : '')).toBe('Eggs');
  });
});

describe('three-way line merge', () => {
  it('merges non-overlapping edits', () => {
    expect(mergeLines('one\ntwo\nthree', 'ONE\ntwo\nthree', 'one\ntwo\nTHREE'))
      .toEqual({ clean: true, content: 'ONE\ntwo\nTHREE' });
  });

  it('uses a changed side when the other side is unchanged', () => {
    expect(mergeLines('a\nb', 'a\nb', 'a\nB')).toEqual({ clean: true, content: 'a\nB' });
  });

  it('reports edits to the same line as a conflict', () => {
    expect(mergeLines('a', 'mine', 'theirs').clean).toBe(false);
  });
});
