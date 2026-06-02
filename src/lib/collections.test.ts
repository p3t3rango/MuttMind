import { describe, expect, it } from 'vitest';
import { canAddCaptureToCollection, compactPositions } from './collections';

describe('canAddCaptureToCollection', () => {
  const baseInput = {
    actorUserId: 'u1',
    nodeCreatedBy: 'u1',
    workspaceAllowMemberCrossPublish: false,
  };

  it('allows the actor to add their own capture when toggle is off', () => {
    expect(canAddCaptureToCollection(baseInput)).toEqual({ ok: true });
  });

  it('denies adding another member\'s capture when toggle is off', () => {
    expect(canAddCaptureToCollection({
      ...baseInput,
      nodeCreatedBy: 'u2',
    })).toEqual({
      ok: false,
      reason: 'cross_publish_disabled',
    });
  });

  it('allows adding another member\'s capture when toggle is on', () => {
    expect(canAddCaptureToCollection({
      ...baseInput,
      nodeCreatedBy: 'u2',
      workspaceAllowMemberCrossPublish: true,
    })).toEqual({ ok: true });
  });

  it('allows adding own capture when toggle is on', () => {
    expect(canAddCaptureToCollection({
      ...baseInput,
      workspaceAllowMemberCrossPublish: true,
    })).toEqual({ ok: true });
  });
});

describe('compactPositions', () => {
  it('preserves order and produces 0-indexed contiguous positions', () => {
    expect(compactPositions([
      { id: 'a', position: 5 },
      { id: 'b', position: 12 },
      { id: 'c', position: 0 },
    ])).toEqual([
      { id: 'c', position: 0 },
      { id: 'a', position: 1 },
      { id: 'b', position: 2 },
    ]);
  });

  it('handles already-contiguous input as identity', () => {
    expect(compactPositions([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 },
    ])).toEqual([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 },
    ]);
  });

  it('is stable on ties (input order wins)', () => {
    expect(compactPositions([
      { id: 'a', position: 1 },
      { id: 'b', position: 1 },
    ])).toEqual([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(compactPositions([])).toEqual([]);
  });
});
