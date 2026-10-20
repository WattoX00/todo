export interface Credentials {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface RepoInfo {
  default_branch: string;
  permissions?: { push?: boolean };
}

export interface FileInfo {
  name: string;
  path: string;
  sha: string;
  type: string;
  download_url?: string | null;
}

export interface ContentFile {
  content: string;
  sha: string;
  etag?: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly resetAt?: number,
    readonly conflict = false,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export class GitHubClient {
  private etags = new Map<string, string>();
  private fileCache = new Map<string, ContentFile>();
  private directoryEtag?: string;
  private directoryCache?: FileInfo[];

  constructor(readonly credentials: Credentials, private readonly fetcher: typeof fetch = fetch) {}

  async validate(): Promise<RepoInfo> {
    const path = `/repos/${this.credentials.owner}/${this.credentials.repo}`;
    let repo: RepoInfo;
    try {
      repo = await this.request<RepoInfo>(path);
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
      repo = await this.request<RepoInfo>(path);
    }
    if (!repo.permissions?.push) throw new GitHubError('This token does not have write access to the repository.', 403);
    return repo;
  }

  async listFiles(): Promise<FileInfo[]> {
    const path = `/repos/${this.credentials.owner}/${this.credentials.repo}/contents/lists?ref=${encodeURIComponent(this.credentials.branch)}`;
    let response: Response;
    try {
      response = await this.fetcher(this.url(path), {
        headers: this.headers(this.directoryEtag ? { 'If-None-Match': this.directoryEtag } : {}),
      });
    } catch {
      throw new GitHubError('Network unavailable. Check your connection and try again.', 0);
    }
    if (response.status === 304 && this.directoryCache) return this.directoryCache;
    if (response.status === 404) {
      this.directoryCache = [];
      this.directoryEtag = undefined;
      return [];
    }
    if (!response.ok) throw await this.errorFrom(response);
    const data = await response.json() as FileInfo[];
    const files = Array.isArray(data) ? data.filter((file) => file.type === 'file' && file.name.endsWith('.txt')) : [];
    this.directoryCache = files;
    this.directoryEtag = response.headers.get('ETag') ?? undefined;
    return files;
  }

  async getFile(path: string, force = false, cached?: ContentFile): Promise<ContentFile> {
    const url = this.url(`/repos/${this.credentials.owner}/${this.credentials.repo}/contents/${this.encodePath(path)}?ref=${encodeURIComponent(this.credentials.branch)}`);
    if (cached) this.fileCache.set(path, cached);
    const etag = force ? undefined : this.etags.get(path) ?? cached?.etag;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: this.headers(etag ? { 'If-None-Match': etag } : {}),
      });
    } catch {
      throw new GitHubError('Network unavailable. Your changes are saved on this device.', 0);
    }
    if (response.status === 304) {
      const cached = this.fileCache.get(path);
      if (cached) return cached;
      throw new GitHubError('GitHub returned an unchanged response without a cached file.', 304);
    }
    if (!response.ok) throw await this.errorFrom(response);
    const data = await response.json() as { content: string; sha: string };
    const responseEtag = response.headers.get('ETag') ?? undefined;
    const file = { content: decodeBase64Utf8(data.content), sha: data.sha, etag: responseEtag };
    this.fileCache.set(path, file);
    if (responseEtag) this.etags.set(path, responseEtag);
    return file;
  }

  async putFile(path: string, content: string, message: string, sha?: string): Promise<string> {
    this.etags.delete(path);
    this.fileCache.delete(path);
    this.directoryEtag = undefined;
    this.directoryCache = undefined;
    const body: Record<string, string> = {
      message,
      content: encodeBase64Utf8(content),
      branch: this.credentials.branch,
    };
    if (sha) body.sha = sha;
    const response = await this.send(`/repos/${this.credentials.owner}/${this.credentials.repo}/contents/${this.encodePath(path)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    const result = await response.json() as { content: { sha: string } };
    return result.content.sha;
  }

  async deleteFile(path: string, sha: string, message: string): Promise<void> {
    await this.send(`/repos/${this.credentials.owner}/${this.credentials.repo}/contents/${this.encodePath(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, branch: this.credentials.branch }),
    });
    this.etags.delete(path);
    this.fileCache.delete(path);
    this.directoryEtag = undefined;
    this.directoryCache = undefined;
  }

  private async request<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.url(path), { headers: this.headers() });
    } catch {
      throw new GitHubError('Could not reach GitHub. Check your connection, VPN, firewall, or browser extensions, then try again.', 0);
    }
    if (!response.ok) throw await this.errorFrom(response);
    return await response.json() as T;
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(this.url(path), {
        ...init,
        headers: this.headers({ 'Content-Type': 'application/json' }),
      });
    } catch {
      throw new GitHubError('Network unavailable. Your changes are saved on this device.', 0);
    }
    if (!response.ok) throw await this.errorFrom(response);
    return response;
  }

  private async errorFrom(response: Response): Promise<GitHubError> {
    const reset = Number(response.headers.get('X-RateLimit-Reset'));
    const rateLimited = response.status === 429
      || (response.status === 403 && (response.headers.get('X-RateLimit-Remaining') === '0' || response.headers.has('Retry-After')));
    const message = response.status === 401
      ? 'Your GitHub token is invalid or expired.'
      : rateLimited
        ? `GitHub rate limit reached.${reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : ' Please try again later.'}`
        : response.status === 403
          ? 'Access denied. Check the repository name and that the token has Contents read/write permission.'
        : response.status === 404
          ? 'Repository or file not found, or this token cannot access it.'
          : response.status === 409 || response.status === 422
            ? 'This file changed on GitHub. Resolve the conflict before saving.'
            : 'GitHub could not complete the request. Check repository access and try again.';
    return new GitHubError(message, response.status, reset || undefined, response.status === 409 || response.status === 422);
  }

  private headers(extra: Record<string, string> = {}): HeadersInit {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.credentials.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra,
    };
  }

  private url(path: string): string {
    return `https://api.github.com${path}`;
  }

  private encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
  }
}
