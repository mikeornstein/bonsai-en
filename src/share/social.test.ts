import { describe, expect, it, vi } from 'vitest';
import {
  canSystemShare,
  isTreeDeepLink,
  pickShareData,
  portraitFilename,
  shareDraftText,
  shareDraftWithUrl,
  shareSiteUrl,
  xIntentUrl,
} from './social';

describe('share draft + X intent', () => {
  it('draft is short and zen', () => {
    const t = shareDraftText();
    expect(t.length).toBeGreaterThan(10);
    expect(t.length).toBeLessThan(120);
    expect(t.toLowerCase()).toContain('juniper');
    expect(t.toLowerCase()).toContain('bonsai-en');
    expect(t).not.toMatch(/#s=/i);
  });

  it('shareSiteUrl is a short homepage without hash', () => {
    const site = shareSiteUrl({
      origin: 'https://mikeornstein.github.io',
      pathname: '/bonsai-en/',
    });
    expect(site).toBe('https://mikeornstein.github.io/bonsai-en/');
    expect(isTreeDeepLink(site)).toBe(false);
  });

  it('isTreeDeepLink detects state hashes', () => {
    expect(isTreeDeepLink('https://x.test/bonsai-en/#s=abc')).toBe(true);
    expect(isTreeDeepLink('https://x.test/bonsai-en/')).toBe(false);
  });

  it('draft with short site url stacks cleanly (not for tree hashes)', () => {
    const body = shareDraftWithUrl('https://example.com/bonsai-en/');
    expect(body).toContain(shareDraftText());
    expect(body).toContain('https://example.com/bonsai-en/');
    expect(body.split('\n')).toHaveLength(2);
  });

  it('xIntentUrl builds compose with text only by default (no giant url)', () => {
    const href = xIntentUrl({ text: shareDraftText() });
    expect(href.startsWith('https://x.com/intent/post?')).toBe(true);
    const u = new URL(href);
    expect(u.searchParams.get('text')).toBe(shareDraftText());
    expect(u.searchParams.has('url')).toBe(false);
  });

  it('xIntentUrl strips tree deep-links even if passed', () => {
    const href = xIntentUrl({
      text: shareDraftText(),
      url: 'https://example.com/bonsai-en/#s=N4Ig…huge…',
    });
    const u = new URL(href);
    expect(u.searchParams.has('url')).toBe(false);
  });

  it('xIntentUrl allows a short non-deep site url', () => {
    const href = xIntentUrl({
      text: 'hello',
      url: 'https://example.com/bonsai-en/',
    });
    const u = new URL(href);
    expect(u.searchParams.get('url')).toBe('https://example.com/bonsai-en/');
  });

  it('portraitFilename is a stable png name', () => {
    const name = portraitFilename('juniper-procumbens');
    expect(name.startsWith('bonsai-en-juniper-procumbens-')).toBe(true);
    expect(name.endsWith('.png')).toBe(true);
  });
});

describe('Web Share capability helpers', () => {
  it('canSystemShare is false without navigator.share', () => {
    const nav = {} as Navigator;
    expect(canSystemShare({ title: 't', text: 'x' }, nav)).toBe(false);
  });

  it('canSystemShare uses canShare when present', () => {
    const nav = {
      share: vi.fn(),
      canShare: vi.fn((data: ShareData) => Boolean(data.url)),
    } as unknown as Navigator;
    expect(canSystemShare({ url: 'https://x.test' }, nav)).toBe(true);
    expect(canSystemShare({ text: 'only' }, nav)).toBe(false);
  });

  it('pickShareData prefers files and omits tree deep-link urls', () => {
    const file = new File(['x'], 't.png', { type: 'image/png' });
    const nav = {
      share: vi.fn(),
      canShare: vi.fn((data: ShareData) => Array.isArray(data.files)),
    } as unknown as Navigator;
    const data = pickShareData({
      text: 'hi',
      url: 'https://example.com/bonsai-en/#s=abc',
      file,
      nav,
    });
    expect(data?.files?.[0]).toBe(file);
    expect(data?.url).toBeUndefined();
    expect(data?.text).toBe('hi');
  });

  it('pickShareData falls back to short site url when files rejected', () => {
    const file = new File(['x'], 't.png', { type: 'image/png' });
    const nav = {
      share: vi.fn(),
      canShare: vi.fn((data: ShareData) => !data.files),
    } as unknown as Navigator;
    const data = pickShareData({
      text: 'hi',
      url: 'https://example.com/bonsai-en/',
      file,
      nav,
    });
    expect(data?.files).toBeUndefined();
    expect(data?.url).toBe('https://example.com/bonsai-en/');
  });

  it('pickShareData never attaches a tree deep-link as url fallback', () => {
    const nav = {
      share: vi.fn(),
      canShare: vi.fn((data: ShareData) => Boolean(data.text)),
    } as unknown as Navigator;
    const data = pickShareData({
      text: 'hi',
      url: 'https://example.com/bonsai-en/#s=huge',
      nav,
    });
    expect(data?.url).toBeUndefined();
    expect(data?.text).toBe('hi');
  });

  it('pickShareData returns null when nothing is shareable', () => {
    const nav = {
      share: vi.fn(),
      canShare: () => false,
    } as unknown as Navigator;
    expect(
      pickShareData({ text: 'hi', url: 'https://example.com/', nav }),
    ).toBeNull();
  });
});
