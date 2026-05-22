import { describe, expect, it } from 'vitest';
import { defaultFeedsPriming, formatInsightsForPrompt, type Insight } from './insights';

function make(partial: Partial<Insight>): Insight {
  return {
    id: 'x', workspace_id: 'w', created_by: null, title: null, body: 'b',
    created_at: '', updated_at: '', source_node_id: null, source_node_ids: [],
    source_kind: null, feeds_priming: true, author: null, ...partial,
  };
}

describe('defaultFeedsPriming', () => {
  it('hand-written (null kind) feeds by default', () => {
    expect(defaultFeedsPriming(null)).toBe(true);
  });
  it('learned feeds by default', () => {
    expect(defaultFeedsPriming('learned')).toBe(true);
  });
  it('saved AI artifacts (chat/lens/essay) start muted', () => {
    expect(defaultFeedsPriming('chat')).toBe(false);
    expect(defaultFeedsPriming('lens:gist')).toBe(false);
    expect(defaultFeedsPriming('essay')).toBe(false);
  });
});

describe('formatInsightsForPrompt priming filter', () => {
  it('excludes muted insights', () => {
    const out = formatInsightsForPrompt([
      make({ body: 'KEEP-ME', feeds_priming: true }),
      make({ body: 'DROP-ME', feeds_priming: false }),
    ]);
    expect(out).toContain('KEEP-ME');
    expect(out).not.toContain('DROP-ME');
  });
  it('treats undefined/legacy feeds_priming as feeding', () => {
    const legacy = make({ body: 'LEGACY' });
    delete (legacy as Partial<Insight>).feeds_priming;
    expect(formatInsightsForPrompt([legacy])).toContain('LEGACY');
  });
});
