import { describe, expect, it } from 'vitest';
import { safeHttpHref } from './safe-href';

describe('safeHttpHref', () => {
  it('returns http URLs unchanged', () => {
    expect(safeHttpHref('http://example.com/path')).toBe('http://example.com/path');
  });

  it('returns https URLs unchanged', () => {
    expect(safeHttpHref('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('returns null for javascript: scheme', () => {
    expect(safeHttpHref('javascript:alert(1)')).toBeNull();
    expect(safeHttpHref('JaVaScRiPt:alert(1)')).toBeNull();
  });

  it('returns null for data: scheme', () => {
    expect(safeHttpHref('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('returns null for vbscript: scheme', () => {
    expect(safeHttpHref('vbscript:msgbox(1)')).toBeNull();
  });

  it('returns null for file: scheme', () => {
    expect(safeHttpHref('file:///etc/passwd')).toBeNull();
  });

  it('returns null for protocol-relative URLs', () => {
    expect(safeHttpHref('//evil.com/x')).toBeNull();
  });

  it('returns null for relative URLs', () => {
    expect(safeHttpHref('/local/path')).toBeNull();
    expect(safeHttpHref('foo/bar')).toBeNull();
  });

  it('returns null for null/undefined/non-string', () => {
    expect(safeHttpHref(null)).toBeNull();
    expect(safeHttpHref(undefined)).toBeNull();
    expect(safeHttpHref('' as string)).toBeNull();
  });

  it('trims leading whitespace before checking scheme', () => {
    expect(safeHttpHref('  https://example.com')).toBe('  https://example.com');
    expect(safeHttpHref('  javascript:alert(1)')).toBeNull();
  });
});
