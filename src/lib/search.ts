export type SearchCapture = {
  id: string;
  workspace_id: string;
  title: string | null;
  kind: 'capture';
  url: string | null;
  summary: string | null;
};

export type SearchInsight = {
  id: string;
  workspace_id: string;
  title: string | null;
  kind: 'insight';
  snippet: string;
  source_kind: string | null;
};

export type SearchGroup = {
  mindId: string;
  mindName: string;
  captures: SearchCapture[];
  insights: SearchInsight[];
};

/**
 * Make a raw query safe for a PostgREST `.or(...)` ilike filter: strip the
 * characters that have meaning in that mini-grammar ( , ( ) * % : . ) so user
 * input can't break or inject into the filter string. Collapse whitespace.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()*%:.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Group captures + insights by Mind. Drops any whose mind isn't in `minds`
 *  (membership guard). Sorts groups by total hit count desc, then mind name. */
export function groupSearchResults(
  captures: SearchCapture[],
  insights: SearchInsight[],
  minds: Map<string, string>,
): SearchGroup[] {
  const byId = new Map<string, SearchGroup>();
  const ensure = (wsId: string): SearchGroup | null => {
    const name = minds.get(wsId);
    if (name === undefined) return null;
    let g = byId.get(wsId);
    if (!g) {
      g = { mindId: wsId, mindName: name, captures: [], insights: [] };
      byId.set(wsId, g);
    }
    return g;
  };
  for (const c of captures) ensure(c.workspace_id)?.captures.push(c);
  for (const i of insights) ensure(i.workspace_id)?.insights.push(i);
  return [...byId.values()].sort((a, b) => {
    const diff = b.captures.length + b.insights.length - (a.captures.length + a.insights.length);
    return diff !== 0 ? diff : a.mindName.localeCompare(b.mindName);
  });
}
