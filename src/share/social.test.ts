import { describe, expect, it, vi } from 'vitest';
import {
  canSystemShare,
  pickShareData,
  portraitFilename,
  shareDraftText,
  shareDraftWithUrl,
  xIntentUrl,
} from './social';

describe('share draft + X intent', () => {
  it('draft is short and zen', () => {
    const t = shareDraftText();
    expect(t.length).toBeGreaterThan(10);
    expect(t.length).toBeLessThan(120);
    expect(t.toLowerCase()).toContain('juniper');
    expect(t.toLowerCase()).toContain('bonsai-en');
  });

  it('draft with url stacks cleanly for Messages', () => {
    const body = shareDraftWithUrl('https://example.com/bonsai-en/#s=abc');
    expect(body).toContain(shareDraftText());
    expect(body).toContain('https://example.com/bonsai-en/#s=abc');
    expect(body.split('\n')).toHaveLength(2);
  });

  it('xIntentUrl builds compose link with text and url', () => {
    const href = xIntentUrl({
      text: shareDraftText(),
      url: 'https://example.com/bonsai-en/#s=xyz',
    });
    expect(href.startsWith('https://x.com/intent/post?')).toBe(true);
    const u = new URL(href);
    expect(u.searchParams.get('text')).toBe(shareDraftText());
    expect(u.searchParams.get('url')).toBe(
      'https://example.com/bonsai-en/#s=xyz',
    );
  });

  it('xIntentUrl omits url param when missing', () => {
    const href = xIntentUrl({ text: 'hello' });
    const u = new URL(href);
    expect(u.searchParams.get('text')).toBe('hello');
    expect(u.searchParams.has('url')).toBe(false);
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

  it('pickShareData prefers files when canShare allows', () => {
    const file = new File(['x'], 't.png', { type: 'image/png' });
    const nav = {
      share: vi.fn(),
      canShare: vi.fn((data: ShareData) => Array.isArray(data.files)),
    } as unknown as Navigator;
    const data = pickShareData({
      text: 'hi',
      url: 'https://example.com/',
      file,
      nav,
    });
    expect(data?.files?.[0]).toBe(file);
    expect(data?.url).toBe('https://example.com/');
  });

  it('pickShareData falls back to url-only when files rejected', () => {
    const file = new File(['x'], 't.png', { type: 'image/png' });
    const nav = {
      share: vi.fn(),
      canShare: vi.fn((data: ShareData) => !data.files),
    } as unknown as Navigator;
    const data = pickShareData({
      text: 'hi',
      url: 'https://example.com/',
      file,
      nav,
    });
    expect(data?.files).toBeUndefined();
    expect(data?.url).toBe('https://example.com/');
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
