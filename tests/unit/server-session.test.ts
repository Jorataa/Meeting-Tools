import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
import { sameOrigin } from '@/lib/server-session';
function request(url: string, origin?: string, host?: string, proto?: string) {
  const headers = new Headers(); if (origin) headers.set('origin', origin); if (host) headers.set('host', host); if (proto) headers.set('x-forwarded-proto', proto);
  return new Request(url, { method: 'POST', headers });
}
describe('public request origin', () => {
  it('accepts a browser hostname when Next uses the internal bind address', () => {
    expect(sameOrigin(request('http://0.0.0.0:3000/api/session', 'http://localhost:3000', 'localhost:3000'))).toBe(true);
  });
  it('accepts the HTTPS public origin behind a reverse proxy', () => {
    expect(sameOrigin(request('http://0.0.0.0:3000/api/session', 'https://hush.example.com', 'hush.example.com', 'https'))).toBe(true);
  });
  it('rejects cross-origin requests, absent origins and malformed origins', () => {
    expect(sameOrigin(request('http://localhost:3000', 'https://attacker.example', 'localhost:3000'))).toBe(false);
    expect(sameOrigin(request('http://localhost:3000'))).toBe(false);
    expect(sameOrigin(request('http://localhost:3000', 'null'))).toBe(false);
  });
  it('rejects other ports and unexpected protocols', () => {
    expect(sameOrigin(request('http://localhost:3000', 'http://localhost:3001'))).toBe(false);
    expect(sameOrigin(request('http://localhost:3000', 'https://localhost:3000'))).toBe(false);
  });
});
