import { describe, expect, it } from 'vitest';
import { sanitizeSearchTerm, groupSearchResults, type SearchCapture, type SearchInsight } from './search';

describe('sanitizeSearchTerm', () => {
  it('keeps words and spaces', () => {
    expect(sanitizeSearchTerm('  brand refresh ')).toBe('brand refresh');
  });
  it('strips PostgREST-breaking chars (, ( ) * % : .)', () => {
    expect(sanitizeSearchTerm('a,b(c)*d%e:f.g')).toBe('a b c d e f g');
  });
  it('collapses whitespace and returns empty for junk-only', () => {
    expect(sanitizeSearchTerm('   ')).toBe('');
    expect(sanitizeSearchTerm('(),.')).toBe('');
  });
});

describe('groupSearchResults', () => {
  const minds = new Map([['m1', 'Alpha'], ['m2', 'Beta']]);
  const caps: SearchCapture[] = [
    { id: 'c1', workspace_id: 'm1', title: 'A', kind: 'capture', url: null, summary: null },
    { id: 'c2', workspace_id: 'm2', title: 'B', kind: 'capture', url: null, summary: null },
  ];
  const ins: SearchInsight[] = [
    { id: 'i1', workspace_id: 'm1', title: 'I', kind: 'insight', snippet: 'x', source_kind: 'chat' },
  ];
  it('groups captures + insights by mind, with mind names, sorted by hit count desc', () => {
    const groups = groupSearchResults(caps, ins, minds);
    expect(groups.map((g) => g.mindId)).toEqual(['m1', 'm2']);
    expect(groups[0]).toMatchObject({ mindId: 'm1', mindName: 'Alpha' });
    expect(groups[0].captures).toHaveLength(1);
    expect(groups[0].insights).toHaveLength(1);
    expect(groups[1].mindId).toBe('m2');
  });
  it('drops results whose mind is not in the membership map (no leakage)', () => {
    const stray: SearchCapture[] = [{ id: 'x', workspace_id: 'm9', title: 'X', kind: 'capture', url: null, summary: null }];
    expect(groupSearchResults(stray, [], minds)).toEqual([]);
  });
});
