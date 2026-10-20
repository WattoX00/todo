import { describe, expect, it, vi } from 'vitest';
import { decodeBase64Utf8, encodeBase64Utf8, GitHubClient, GitHubError } from '../src/api/github';

const credentials = { token: 'never-in-error-message', owner: 'owner', repo: 'private-todos', branch: 'main' };
const response = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('UTF-8 base64 helpers', () => {
  it('round-trips accented characters and emoji', () => {
    const text = 'Crème brûlée 🥐 東京';
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });
});

describe('GitHub Contents API errors', () => {
  it('reports 401 without revealing the token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(401, { message: 'bad credentials' }));
    const client = new GitHubClient(credentials, fetcher);
    await expect(client.validate()).rejects.toMatchObject({ status: 401 });
    await expect(client.validate()).rejects.not.toThrow(credentials.token);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/owner/private-todos');
    expect((fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe(`Bearer ${credentials.token}`);
  });

  it('treats a missing lists directory as an empty first-run repo', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(404));
    expect(await new GitHubClient(credentials, fetcher).listFiles()).toEqual([]);
  });

  it('marks 409 and 422 responses as content conflicts', async () => {
    for (const status of [409, 422]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(status));
      await expect(new GitHubClient(credentials, fetcher).putFile('lists/a.txt', '# A', 'Update a', 'sha'))
        .rejects.toMatchObject({ status, conflict: true });
    }
  });

  it('uses the chosen branch and latest file SHA in Contents API writes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(200, { content: { sha: 'next-sha' } }));
    const client = new GitHubClient(credentials, fetcher);
    await expect(client.putFile('lists/my list.txt', '# List\n\n', 'Update list', 'current-sha')).resolves.toBe('next-sha');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/owner/private-todos/contents/lists/my%20list.txt');
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      sha: 'current-sha',
      branch: 'main',
      message: 'Update list',
    });
  });

  it('includes the rate-limit reset time without exposing response details', async () => {
    const reset = '1900000000';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(403, { message: 'secret details' }, {
      'X-RateLimit-Reset': reset,
      'X-RateLimit-Remaining': '0',
    }));
    await expect(new GitHubClient(credentials, fetcher).listFiles()).rejects.toMatchObject({
      status: 403,
      resetAt: Number(reset),
    });

    try {
      await new GitHubClient(credentials, fetcher).listFiles();
    } catch (error) {
      expect((error as GitHubError).message).not.toContain('secret details');
      expect((error as Error).message).not.toContain(credentials.token);
    }
  });

  it('distinguishes a permission-denied 403 from rate limiting', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(403, { message: 'forbidden' }));
    await expect(new GitHubClient(credentials, fetcher).validate()).rejects.toThrow('Access denied.');
  });

  it('surfaces offline network failures as a safe, retryable error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    await expect(new GitHubClient(credentials, fetcher).listFiles()).rejects.toMatchObject({ status: 0 });
  });

  it('retries repository validation once after a network failure', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response(200, { default_branch: 'main', permissions: { push: true } }));

    await expect(new GitHubClient(credentials, fetcher).validate()).resolves.toMatchObject({
      default_branch: 'main',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports a persistent connection failure without leaking request details', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    await expect(new GitHubClient(credentials, fetcher).validate())
      .rejects.toThrow('Could not reach GitHub.');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses a cached ETag and content for conditional file refreshes', async () => {
    const content = encodeBase64Utf8('# Cached\n\n- [ ] keep');
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { content, sha: 'abc' }, { ETag: '"v1"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = new GitHubClient(credentials, fetcher);
    expect(await client.getFile('lists/cached.txt')).toMatchObject({ content: '# Cached\n\n- [ ] keep', sha: 'abc' });
    expect(await client.getFile('lists/cached.txt')).toMatchObject({ content: '# Cached\n\n- [ ] keep', sha: 'abc' });
    expect((fetcher.mock.calls[1]?.[1]?.headers as Record<string, string>)['If-None-Match']).toBe('"v1"');
  });
});
