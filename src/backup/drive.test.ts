import { describe, it, expect } from 'vitest';
import {
  base64UrlEncode,
  buildAuthUrl,
  buildDriveMultipart,
  generateCodeVerifier,
  generatePkceChallenge,
} from './drive';

describe('base64UrlEncode', () => {
  it('encodes bytes URL-safe (no +, /, or = padding)', () => {
    const encoded = base64UrlEncode(new Uint8Array([1, 2, 3, 4]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('matches a known value', () => {
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
  });
});

describe('generateCodeVerifier', () => {
  it('produces a verifier within RFC 7636 constraints (43–128 chars, unreserved set)', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(64);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('produces different verifiers on successive calls', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('generatePkceChallenge', () => {
  it('is the base64url SHA-256 of the verifier (43 chars, unpadded)', async () => {
    // crypto.getRandomValues reads a real RNG, so use a fixed verifier here —
    // the point of this assertion is the challenge derivation, not randomness.
    const verifier = 'some-verifier-that-we-choose-deterministically';
    const challenge = await generatePkceChallenge(verifier);
    expect(challenge).toHaveLength(43);
    expect(challenge).not.toMatch(/[+/=]/);

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    expect(challenge).toBe(base64UrlEncode(new Uint8Array(digest)));
  });
});

describe('buildAuthUrl', () => {
  it('includes every required OAuth parameter', () => {
    const url = buildAuthUrl({
      clientId: 'CLIENT_ID',
      redirectUri: 'https://app.example/',
      codeChallenge: 'challenge-value',
      state: 'state-123',
    });
    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);

    const params = new URL(url).searchParams;
    expect(params.get('client_id')).toBe('CLIENT_ID');
    expect(params.get('redirect_uri')).toBe('https://app.example/');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(params.get('code_challenge')).toBe('challenge-value');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('state')).toBe('state-123');
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
  });
});

describe('buildDriveMultipart', () => {
  it('embeds metadata and media JSON inside a multipart/related body', () => {
    const { boundary, body } = buildDriveMultipart(
      { name: 'backup.json', parents: ['folder-1'] },
      '{"format":"test"}',
    );

    expect(body).toContain(`--${boundary}\r\nContent-Type: application/json`);
    expect(body).toContain('"name":"backup.json"');
    expect(body).toContain('{"format":"test"}');
    expect(body.endsWith(`--${boundary}--`)).toBe(true);

    // boundary tokens are url-safe so they can't collide with JSON content
    expect(boundary).toMatch(/^wholesale-app-[a-z0-9]+$/);
  });
});
