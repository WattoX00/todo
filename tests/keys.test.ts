import { describe, expect, it } from 'vitest';
import { matchSequence } from '../src/keys/registry';

describe('key sequence matching', () => {
  it('recognizes the second key of gg, dd, and yy sequences', () => {
    expect(matchSequence('g', 'g', ['gg'])).toMatchObject({ matched: 'gg', pending: '' });
    expect(matchSequence('d', 'd', ['dd'])).toMatchObject({ matched: 'dd', pending: '' });
    expect(matchSequence('y', 'y', ['yy'])).toMatchObject({ matched: 'yy', pending: '' });
  });

  it('retains a partial sequence and its timeout', () => {
    expect(matchSequence('g', '', ['gg'])).toMatchObject({ pending: 'g', timeout: 800 });
    expect(matchSequence('x', 'g', ['gg'])).toMatchObject({ pending: '' });
  });
});
