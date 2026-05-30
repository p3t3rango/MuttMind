import { describe, expect, it } from 'vitest';
import { parsePdfDate } from './pdf-date';

describe('parsePdfDate', () => {
  it('parses a full UTC PDF date', () => {
    expect(parsePdfDate('D:20230615123456Z')).toBe('2023-06-15T12:34:56.000Z');
  });
  it('parses a tz-offset PDF date', () => {
    // +05'00' means local time is 5h ahead of UTC, so UTC is 5h earlier.
    expect(parsePdfDate("D:20230615123456+05'00'")).toBe('2023-06-15T07:34:56.000Z');
  });
  it('parses a date-only PDF date (no time)', () => {
    expect(parsePdfDate('D:20230615')).toBe('2023-06-15T00:00:00.000Z');
  });
  it('parses a year-only PDF date', () => {
    expect(parsePdfDate('D:2023')).toBe('2023-01-01T00:00:00.000Z');
  });
  it('returns null for malformed input', () => {
    expect(parsePdfDate('not a pdf date')).toBeNull();
    expect(parsePdfDate('D:abcd')).toBeNull();
    expect(parsePdfDate('')).toBeNull();
  });
  it('returns null for non-string input', () => {
    expect(parsePdfDate(undefined as unknown as string)).toBeNull();
    expect(parsePdfDate(null as unknown as string)).toBeNull();
  });
});
