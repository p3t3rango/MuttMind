import { describe, expect, it } from 'vitest';
import { foldTags } from './tags';

describe('foldTags', () => {
  it('passes tags through when nothing matches existing vocabulary', () => {
    expect(foldTags(['radical-politics', 'zine'], ['architecture'])).toEqual([
      'radical-politics',
      'zine',
    ]);
  });

  it('reuses the existing tag when the candidate is its plural', () => {
    expect(foldTags(['zines'], ['zine'])).toEqual(['zine']);
  });

  it('reuses the existing tag when the candidate is its singular', () => {
    expect(foldTags(['zine'], ['zines'])).toEqual(['zines']);
  });

  it('folds -ies/-y plural variants toward the existing tag', () => {
    expect(foldTags(['technologies'], ['technology'])).toEqual(['technology']);
  });

  it('folds -es plurals with sibilant stems (boxes → box)', () => {
    expect(foldTags(['boxes'], ['box'])).toEqual(['box']);
  });

  it('treats hyphen variants as the same tag (scifi → sci-fi)', () => {
    expect(foldTags(['scifi'], ['sci-fi'])).toEqual(['sci-fi']);
  });

  it('folds combined hyphen+plural variants (art-movements → art-movement)', () => {
    expect(foldTags(['art-movements'], ['art-movement'])).toEqual(['art-movement']);
  });

  it('dedupes near-duplicates within one batch, keeping the first occurrence', () => {
    expect(foldTags(['zine', 'zines', 'collage'], [])).toEqual(['zine', 'collage']);
  });

  it('does not fold very short stems where suffix rules misfire (news ≠ new)', () => {
    expect(foldTags(['news'], ['new'])).toEqual(['news']);
  });

  it('leaves multi-word conceptual tags alone when they only share a prefix', () => {
    expect(foldTags(['radical-politics'], ['radical'])).toEqual(['radical-politics']);
  });

  it('keeps exact matches as-is and drops exact duplicates in the batch', () => {
    expect(foldTags(['zine', 'zine'], ['zine'])).toEqual(['zine']);
  });
});
