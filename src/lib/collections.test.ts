import { describe, expect, it } from 'vitest';
import { canAddCaptureToCollection } from './collections';

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
