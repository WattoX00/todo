import { beforeEach, describe, expect, it } from 'vitest';
import { clearCache, clearCredentials, loadCache, loadCredentials, saveCache, saveCredentials } from '../src/storage/local';
import type { Credentials } from '../src/api/github';

const credentials: Credentials = { token: 'test-token', owner: 'user', repo: 'private-todos', branch: 'main' };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('browser storage', () => {
  it('uses session storage when remember-me is unchecked', () => {
    saveCredentials(credentials, false);
    expect(localStorage.length).toBe(0);
    expect(loadCredentials()).toEqual(credentials);
    expect(sessionStorage.length).toBe(1);
  });

  it('uses local storage when remember-me is checked and clears both on logout', () => {
    saveCredentials(credentials, true);
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(0);
    clearCredentials();
    expect(loadCredentials()).toBeUndefined();
  });

  it('stores and clears an offline list cache scoped to repository and branch', () => {
    const state = {
      lists: [{ path: 'lists/example-a1b2.txt', content: '# Example\n\n', baseContent: '# Example\n\n', sha: 'sha', modifiedAt: 1 }],
    };
    saveCache(credentials, state);
    expect(loadCache(credentials)).toEqual(state);
    clearCache(credentials);
    expect(loadCache(credentials)).toEqual({ lists: [] });
  });

  it('reports a malformed cache instead of silently replacing it with empty data', () => {
    localStorage.setItem('private-todos-cache:user/private-todos:main', '{invalid');
    expect(() => loadCache(credentials)).toThrow('Cached lists could not be read.');
  });
});
