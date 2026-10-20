import type { Credentials } from '../api/github';

export interface CachedList {
  path: string;
  content: string;
  sha?: string;
  etag?: string;
  baseContent: string;
  modifiedAt: number;
  dirty?: boolean;
  deleted?: boolean;
}

export interface StoredState {
  lists: CachedList[];
}

const AUTH_KEY = 'private-todos-auth';

export function saveCredentials(credentials: Credentials, remember: boolean): void {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(AUTH_KEY);
  (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, JSON.stringify(credentials));
}

export function loadCredentials(): Credentials | undefined {
  const raw = localStorage.getItem(AUTH_KEY) ?? sessionStorage.getItem(AUTH_KEY);
  if (!raw) return undefined;
  let parsed: Partial<Credentials>;
  try {
    parsed = JSON.parse(raw) as Partial<Credentials>;
  } catch {
    clearCredentials();
    throw new Error('Saved sign-in details were unreadable and have been cleared. Please sign in again.');
  }
  if (typeof parsed.token !== 'string' || !parsed.token || typeof parsed.owner !== 'string' || !parsed.owner
    || typeof parsed.repo !== 'string' || !parsed.repo) {
    clearCredentials();
    throw new Error('Saved sign-in details were incomplete and have been cleared. Please sign in again.');
  }
  return {
    token: parsed.token,
    owner: parsed.owner,
    repo: parsed.repo,
    branch: typeof parsed.branch === 'string' ? parsed.branch : '',
  };
}

export function clearCredentials(): void {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(AUTH_KEY);
}

export function cacheKey(credentials: Credentials): string {
  return `private-todos-cache:${credentials.owner}/${credentials.repo}:${credentials.branch}`;
}

export function loadCache(credentials: Credentials): StoredState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey(credentials)) ?? '{"lists":[]}');
    if (typeof parsed !== 'object' || parsed === null || !('lists' in parsed) || !Array.isArray(parsed.lists)
      || !parsed.lists.every(isCachedList)) {
      throw new Error('Invalid cache shape');
    }
    return parsed as StoredState;
  } catch {
    throw new Error('Cached lists could not be read. The local cache has not been erased; refresh from GitHub or clear this site’s storage.');
  }
}

function isCachedList(value: unknown): value is CachedList {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<CachedList>;
  return typeof item.path === 'string'
    && item.path.startsWith('lists/')
    && item.path.endsWith('.txt')
    && typeof item.content === 'string'
    && typeof item.baseContent === 'string'
    && typeof item.modifiedAt === 'number'
    && (item.sha === undefined || typeof item.sha === 'string')
    && (item.etag === undefined || typeof item.etag === 'string')
    && (item.dirty === undefined || typeof item.dirty === 'boolean')
    && (item.deleted === undefined || typeof item.deleted === 'boolean');
}

export function saveCache(credentials: Credentials, state: StoredState): void {
  localStorage.setItem(cacheKey(credentials), JSON.stringify(state));
}

export function clearCache(credentials: Credentials): void {
  localStorage.removeItem(cacheKey(credentials));
}
