'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

type Workspace = {
  role: string;
  workspaces: { id: string; name: string; created_at: string };
};

type NodeItem = {
  id: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  source_description: string | null;
  source_author: string | null;
  raw_text: string | null;
  ai_summary: string | null;
  tags: string[];
};

type RelatedNode = {
  id: string;
  title: string | null;
  original_url: string | null;
  ai_summary: string | null;
  source_description: string | null;
  tags: string[];
  similarity: number;
  sharedTags: string[];
};

type GraphGroup = {
  label: string;
  items: NodeItem[];
  x: number;
  y: number;
};

type GraphNodeKind = 'core' | 'capture' | 'meta';
type GraphMetaKind = 'host' | 'tag';

type GraphNode = {
  id: string;
  label: string;
  subtitle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: GraphNodeKind;
  metaKind?: GraphMetaKind;
  groupLabel: string;
  node?: NodeItem;
  count: number;
  connectedIds: string[];
  previewUrl?: string | null;
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: 'core' | 'host' | 'tag' | 'semantic';
};

type ViewTransform = {
  x: number;
  y: number;
  scale: number;
};

type PositionMap = Record<string, { x: number; y: number }>;

function getHostLabel(url: string | null) {
  if (!url) return 'source';

  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'with',
  'that',
  'this',
  'from',
  'your',
  'into',
  'about',
  'page',
  'site',
  'home',
  'blog',
  'http',
  'https',
  'www',
  'com',
  'xyz',
  'org',
  'net',
  'co',
  'app',
  'io',
]);

function normalizePhrase(input: string) {
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywords(input: string) {
  return normalizePhrase(input)
    .split(' ')
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token));
}

function collectSearchText(node: NodeItem) {
  return [
    node.title,
    getHostLabel(node.original_url),
    node.source_author,
    node.source_description,
    node.ai_summary,
    node.raw_text,
    node.tags.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildSemanticLinkPairs(items: NodeItem[]) {
  const entries = items.map((node) => {
    const title = node.title?.trim() ?? '';
    const host = getHostLabel(node.original_url);
    const author = node.source_author?.trim() ?? '';
    const phrases = [normalizePhrase(title), normalizePhrase(author), normalizePhrase(host)].filter(
      (phrase) => phrase.length > 3,
    );
    const keywords = new Set([...extractKeywords(title), ...extractKeywords(author)]);
    return {
      node,
      phrases,
      keywords,
      text: collectSearchText(node),
    };
  });

  const pairs = new Set<string>();

  entries.forEach((entry, index) => {
    entries.slice(index + 1).forEach((candidate) => {
      const directMatch =
        entry.phrases.some((phrase) => phrase && candidate.text.includes(phrase)) ||
        candidate.phrases.some((phrase) => phrase && entry.text.includes(phrase));

      const sharedKeywords = Array.from(entry.keywords).filter((token) => candidate.keywords.has(token));
      const keywordMatch = sharedKeywords.length >= 2;

      if (directMatch || keywordMatch) {
        const key = [entry.node.id, candidate.node.id].sort().join(':');
        pairs.add(key);
      }
    });
  });

  return Array.from(pairs).map((pair) => pair.split(':') as [string, string]);
}

function buildGraphModel(items: NodeItem[], overrides: PositionMap) {
  const hostGroups = new Map<string, NodeItem[]>();
  const tagGroups = new Map<string, NodeItem[]>();
  const captureLookup = new Map<string, GraphNode>();

  items.forEach((node) => {
    const hostLabel = getHostLabel(node.original_url);
    const hostGroup = hostGroups.get(hostLabel) ?? [];
    hostGroup.push(node);
    hostGroups.set(hostLabel, hostGroup);

    node.tags.forEach((tag) => {
      const tagGroup = tagGroups.get(tag) ?? [];
      tagGroup.push(node);
      tagGroups.set(tag, tagGroup);
    });
  });

  const graphGroups: GraphGroup[] = Array.from(tagGroups.entries())
    .filter(([, groupItems]) => groupItems.length > 1)
    .map(([label, groupItems], index, list) => {
      const angle = list.length ? (index / list.length) * Math.PI * 2 - Math.PI / 2 : 0;
      return {
        label,
        items: groupItems,
        x: 50 + Math.cos(angle) * 34,
        y: 50 + Math.sin(angle) * 28,
      };
    });

  const sortedItems = [...items].sort((left, right) => {
    const leftKey = `${left.tags[0] ?? ''}:${left.title ?? ''}:${left.id}`;
    const rightKey = `${right.tags[0] ?? ''}:${right.title ?? ''}:${right.id}`;
    return leftKey.localeCompare(rightKey);
  });
  const graphNodes: GraphNode[] = [];
  const graphEdges: GraphEdge[] = [];
  const semanticPairs = buildSemanticLinkPairs(items);
  const coreId = 'core:muttmind';

  graphNodes.push({
    id: coreId,
    label: 'MuttMind',
    subtitle: `${items.length} capture${items.length === 1 ? '' : 's'}`,
    x: overrides[coreId]?.x ?? 50,
    y: overrides[coreId]?.y ?? 50,
    width: 176,
    height: 82,
    kind: 'core',
    groupLabel: 'core',
    count: items.length,
    connectedIds: sortedItems.map((item) => item.id),
  });

  sortedItems.forEach((node, index) => {
    const count = Math.max(sortedItems.length, 1);
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const ring = count <= 5 ? 1 : 1 + Math.floor(index / 8) * 0.18;
    const baseX = 50 + Math.cos(angle) * 27 * ring;
    const baseY = 50 + Math.sin(angle) * 24 * ring;
    const hostLabel = getHostLabel(node.original_url);
    const title = node.title?.trim() || hostLabel || 'Untitled';
    const subtitle = node.ai_summary || node.source_description || node.original_url || 'No summary available.';
    const width = node.og_image_url ? 250 : 220;
    const height = node.og_image_url ? 132 : 96;
    const resolvedX = overrides[node.id]?.x ?? clamp(baseX, 24, 76);
    const resolvedY = overrides[node.id]?.y ?? clamp(baseY, 22, 78);

    const graphNode: GraphNode = {
      id: node.id,
      label: title,
      subtitle,
      x: resolvedX,
      y: resolvedY,
      width,
      height,
      kind: 'capture',
      groupLabel: node.tags[0] || hostLabel,
      node,
      count: node.tags.length,
      connectedIds: [coreId],
      previewUrl: node.og_image_url,
    };

    graphNodes.push(graphNode);
    captureLookup.set(node.id, graphNode);
    graphEdges.push({ id: `${coreId}-${node.id}`, from: coreId, to: node.id, kind: 'core' });
  });

  const sharedHosts = Array.from(hostGroups.entries()).filter(([, hostItems]) => hostItems.length > 1);
  const hostNodeIds = new Map<string, string>();
  sharedHosts.forEach(([hostLabel, hostItems], index) => {
    const id = `host:${hostLabel}`;
    const angle = (index / Math.max(sharedHosts.length, 1)) * Math.PI * 2 + Math.PI / 5;
    const baseX = 50 + Math.cos(angle) * 33;
    const baseY = 50 + Math.sin(angle) * 29;
    const resolvedX = overrides[id]?.x ?? clamp(baseX, 22, 78);
    const resolvedY = overrides[id]?.y ?? clamp(baseY, 18, 82);

    graphNodes.push({
      id,
      label: hostLabel,
      subtitle: `${hostItems.length} captures`,
      x: resolvedX,
      y: resolvedY,
      width: clamp(170 + hostLabel.length * 6, 230, 390),
      height: hostLabel.length > 24 ? 92 : 78,
      kind: 'meta',
      metaKind: 'host',
      groupLabel: hostLabel,
      count: hostItems.length,
      connectedIds: hostItems.map((item) => item.id),
    });

    hostNodeIds.set(hostLabel, id);
  });

  const sharedTags = Array.from(tagGroups.entries()).filter(([, tagItems]) => tagItems.length > 1);
  const tagNodeIds = new Map<string, string>();
  sharedTags.forEach(([tagLabel, tagItems], index) => {
    const id = `tag:${tagLabel}`;
    const angle = (index / Math.max(sharedTags.length, 1)) * Math.PI * 2 - Math.PI / 4;
    const baseX = 50 + Math.cos(angle) * 31;
    const baseY = 50 + Math.sin(angle) * 27;
    const resolvedX = overrides[id]?.x ?? clamp(baseX, 22, 78);
    const resolvedY = overrides[id]?.y ?? clamp(baseY, 18, 82);

    graphNodes.push({
      id,
      label: tagLabel,
      subtitle: `${tagItems.length} captures`,
      x: resolvedX,
      y: resolvedY,
      width: clamp(170 + tagLabel.length * 6, 230, 390),
      height: tagLabel.length > 24 ? 92 : 78,
      kind: 'meta',
      metaKind: 'tag',
      groupLabel: tagLabel,
      count: tagItems.length,
      connectedIds: tagItems.map((item) => item.id),
    });

    tagNodeIds.set(tagLabel, id);
  });

  captureLookup.forEach((captureNode, captureId) => {
    const original = captureNode.node;
    if (!original) return;

    const hostId = hostNodeIds.get(getHostLabel(original.original_url));
    if (hostId) {
      captureNode.connectedIds.push(hostId);
      graphEdges.push({ id: `${captureId}-${hostId}`, from: captureId, to: hostId, kind: 'host' });
    }

    original.tags.forEach((tag) => {
      const tagId = tagNodeIds.get(tag);
      if (tagId) {
        captureNode.connectedIds.push(tagId);
        graphEdges.push({ id: `${captureId}-${tagId}`, from: captureId, to: tagId, kind: 'tag' });
      }
    });
  });

  semanticPairs.forEach(([leftId, rightId]) => {
    const left = captureLookup.get(leftId);
    const right = captureLookup.get(rightId);
    if (!left || !right) return;

    left.connectedIds.push(right.id);
    right.connectedIds.push(left.id);
    graphEdges.push({ id: `${left.id}-${right.id}-semantic`, from: left.id, to: right.id, kind: 'semantic' });
  });

  return { graphGroups, graphNodes, graphEdges };
}

function GraphStage({
  nodes,
  edges,
  selectedId,
  onSelect,
  onMoveNode,
  onResetLayout,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onResetLayout: () => void;
}) {
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<
    | {
        mode: 'pan';
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        moved: boolean;
      }
    | {
        mode: 'node';
        id: string;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        moved: boolean;
      }
    | null
  >(null);
  const suppressClickRef = useRef(false);

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const element = stageRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    setTransform((current) => {
      const nextScale = clamp(current.scale + (e.deltaY > 0 ? -0.08 : 0.08), 0.58, 2.4);
      const worldX = (cursorX - current.x) / current.scale;
      const worldY = (cursorY - current.y) / current.scale;
      return {
        scale: nextScale,
        x: cursorX - worldX * nextScale,
        y: cursorY - worldY * nextScale,
      };
    });
  };

  const beginPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    dragState.current = {
      mode: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      originX: transform.x,
      originY: transform.y,
      moved: false,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const beginNodeDrag = (e: ReactPointerEvent<HTMLButtonElement>, node: GraphNode) => {
    e.stopPropagation();
    dragState.current = {
      mode: 'node',
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: node.x,
      originY: node.y,
      moved: false,
    };
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const movedEnough = Math.abs(dx) > 3 || Math.abs(dy) > 3;
    if (movedEnough) suppressClickRef.current = true;

    if (drag.mode === 'pan') {
      setTransform({
        x: drag.originX + dx,
        y: drag.originY + dy,
        scale: transform.scale,
      });
      drag.moved = movedEnough;
      return;
    }

    const element = stageRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const halfWidth = ((nodes.find((node) => node.id === drag.id)?.width ?? 160) / rect.width) * 50;
    const halfHeight = ((nodes.find((node) => node.id === drag.id)?.height ?? 80) / rect.height) * 50;
    const nextX = clamp(drag.originX + (dx / rect.width) * 100 / transform.scale, halfWidth + 2, 98 - halfWidth);
    const nextY = clamp(drag.originY + (dy / rect.height) * 100 / transform.scale, halfHeight + 2, 98 - halfHeight);
    onMoveNode(drag.id, nextX, nextY);
    drag.moved = movedEnough;
  };

  const end = () => {
    dragState.current = null;
  };

  const zoomToFit = () => setTransform({ x: 0, y: 0, scale: 1 });

  const resetLayout = () => {
    onResetLayout();
    setTransform({ x: 0, y: 0, scale: 1 });
  };

  const activeIds = useMemo(() => {
    if (!selectedNode) return null;
    return new Set([selectedNode.id, ...selectedNode.connectedIds]);
  }, [selectedNode]);

  const centerX = (node: GraphNode) => node.x;
  const centerY = (node: GraphNode) => node.y;

  return (
    <div className="graph-shell">
      <div
        ref={stageRef}
        className="graph-stage"
        onWheel={onWheel}
        onPointerDown={beginPan}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        role="application"
        aria-label="Relationship map"
      >
        <div
          className="graph-stage__viewport"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          <svg className="graph-stage__edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {edges.map((edge) => {
              const from = nodes.find((node) => node.id === edge.from);
              const to = nodes.find((node) => node.id === edge.to);
              if (!from || !to) return null;
              const dimmed = activeIds ? !(activeIds.has(from.id) && activeIds.has(to.id)) : false;
              return (
                <line
                  key={edge.id}
                  x1={centerX(from)}
                  y1={centerY(from)}
                  x2={centerX(to)}
                  y2={centerY(to)}
                  className={[
                    'graph-edge',
                    `graph-edge--${edge.kind}`,
                    dimmed ? 'graph-edge--dim' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              );
            })}
          </svg>

          {nodes.map((node) => {
            const isSelected = selectedId === node.id;
            const isDimmed = activeIds ? !activeIds.has(node.id) : false;
            const previewStyle = node.previewUrl
              ? { backgroundImage: `linear-gradient(rgba(5, 5, 5, 0.28), rgba(5, 5, 5, 0.72)), url(${node.previewUrl})` }
              : undefined;

            return (
              <button
                key={node.id}
                type="button"
                className={[
                  'graph-node',
                  `graph-node--${node.kind}`,
                  node.metaKind ? `graph-node--${node.metaKind}` : '',
                  isSelected ? 'is-selected' : '',
                  isDimmed ? 'is-dimmed' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  width: `${node.width}px`,
                  height: `${node.height}px`,
                }}
                title={node.label}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  onSelect(node.id);
                }}
                onPointerDown={(e) => beginNodeDrag(e, node)}
              >
                {node.kind === 'core' ? (
                  <span className="graph-node__content graph-node__content--core">
                    <span className="graph-node__eyebrow">Mind core</span>
                    <strong>{node.label}</strong>
                    <span>{node.count} captures</span>
                  </span>
                ) : node.kind === 'capture' ? (
                  <span
                    className="graph-node__content graph-node__content--capture"
                    style={previewStyle}
                  >
                    <span className="graph-node__eyebrow">{node.node ? getHostLabel(node.node.original_url) : node.groupLabel}</span>
                    <strong>{node.label}</strong>
                    <span>{node.count ? `${node.count} tag${node.count === 1 ? '' : 's'}` : getHostLabel(node.node?.original_url ?? null)}</span>
                  </span>
                ) : (
                  <span className="graph-node__content graph-node__content--meta">
                    <span className="graph-node__eyebrow">{node.metaKind === 'tag' ? 'Tag' : 'Source'}</span>
                    <strong>{node.label}</strong>
                    <span>{node.count} saved</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="graph-hint">Pan, zoom, drag cards, click to inspect.</div>
        <div className="graph-controls">
          <button type="button" className="button-ghost" onClick={zoomToFit}>
            Reset View
          </button>
          <button type="button" className="button-ghost" onClick={resetLayout}>
            Reset Layout
          </button>
        </div>
      </div>

    </div>
  );
}

function VaultContent() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [status, setStatus] = useState('Loading Minds...');
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutOverrides, setLayoutOverrides] = useState<PositionMap>({});
  const [relatedNodes, setRelatedNodes] = useState<RelatedNode[]>([]);

  const layoutKey = useMemo(() => {
    if (!workspaceId) return '';
    return `muttmind:vault-layout:v5:${workspaceId}`;
  }, [workspaceId]);

  useEffect(() => {
    (async () => {
      const r = await authedFetch('/api/workspaces');
      const d = await r.json();
      const nextWorkspaces = d.workspaces ?? [];
      setWorkspaces(nextWorkspaces);
      setWorkspaceId((current) => current || nextWorkspaces[0]?.workspaces.id || '');

      if (!nextWorkspaces.length) {
        setStatus('No Minds found. Create one from the Mind view first.');
      }
    })();
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setLayoutOverrides({});
      return;
    }

    try {
      const raw = window.localStorage.getItem(layoutKey);
      setLayoutOverrides(raw ? JSON.parse(raw) : {});
    } catch {
      setLayoutOverrides({});
    }
  }, [layoutKey, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;

    try {
      window.localStorage.setItem(layoutKey, JSON.stringify(layoutOverrides));
    } catch {
      // Ignore storage quota or privacy errors.
    }
  }, [layoutKey, layoutOverrides, workspaceId]);

  useEffect(() => {
    (async () => {
      if (!workspaceId) {
        setNodes([]);
        setSelectedId(null);
        return;
      }

      setStatus('Loading Mind...');
      const r = await authedFetch(`/api/nodes?workspaceId=${workspaceId}`);
      const d = await r.json();
      const nextNodes: NodeItem[] = d.nodes ?? [];
      setNodes(nextNodes);
      setStatus(nextNodes.length ? 'Mind loaded.' : 'No captures found for this Mind.');
      setSelectedId((current) => {
        if (current && nextNodes.some((node: NodeItem) => node.id === current)) return current;
        return null;
      });
    })();
  }, [workspaceId]);

  const clearVault = async () => {
    if (!workspaceId) return;
    if (!confirm('Clear all captures in this Mind?')) return;
    setStatus('Clearing Mind...');
    const r = await authedFetch(`/api/nodes?workspaceId=${workspaceId}`, {
      method: 'DELETE',
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Unable to clear Mind.');
      return;
    }
    setNodes([]);
    setSelectedId(null);
    setStatus('Library cleared.');
  };

  const deleteCapture = async (nodeId: string) => {
    if (!workspaceId) return;
    if (!confirm('Delete this capture?')) return;
    setStatus('Deleting capture...');
    const r = await authedFetch(`/api/nodes?workspaceId=${workspaceId}&nodeId=${nodeId}`, {
      method: 'DELETE',
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Unable to delete capture.');
      return;
    }
    const nextNodes = nodes.filter((node) => node.id !== nodeId);
    setNodes(nextNodes);
    setSelectedId((current) => (current === nodeId ? null : current));
    setStatus('Capture deleted.');
  };

  const resetLayout = () => {
    if (!workspaceId) return;
    setLayoutOverrides({});
    try {
      window.localStorage.removeItem(layoutKey);
    } catch {
      // Ignore storage errors.
    }
    setStatus('Map layout reset.');
  };

  const filteredNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((node) => {
      const haystack = [
        node.title,
        node.original_url,
        node.source_description,
        node.ai_summary,
        node.tags.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [nodes, search]);

  const { graphGroups, graphNodes, graphEdges } = useMemo(
    () => buildGraphModel(filteredNodes, layoutOverrides),
    [filteredNodes, layoutOverrides],
  );

  const selectedGraphNode = graphNodes.find((node) => node.id === selectedId) ?? null;
  const selectedCapture = selectedGraphNode?.kind === 'capture' ? selectedGraphNode.node ?? null : null;
  const relatedCaptures = selectedGraphNode
    ? graphNodes.filter((node) => node.kind === 'capture' && node.connectedIds.includes(selectedGraphNode.id))
    : [];

  useEffect(() => {
    (async () => {
      if (!workspaceId || !selectedGraphNode || selectedGraphNode.kind !== 'capture') {
        setRelatedNodes([]);
        return;
      }

      const r = await authedFetch(`/api/nodes/${selectedGraphNode.id}/related?workspaceId=${workspaceId}`);
      const d = await r.json();
      setRelatedNodes((d.related ?? []) as RelatedNode[]);
    })();
  }, [workspaceId, selectedGraphNode?.id]);

  return (
    <main className="app-shell">
      <AppNav active="vault" />

      <section className="section-header section-header--compact section-header--vault" aria-labelledby="vault-title">
        <div>
          <p className="eyebrow">§ Mind / Saved intelligence</p>
          <h1 id="vault-title">Mind map.</h1>
          <p className="lede">
            Inspect how captures connect by source, tag, and semantic similarity.
          </p>
        </div>
        <Link href="/dashboard" className="button-secondary">
          Save More
        </Link>
      </section>

      <section className="panel vault-controls">
        <div className="panel-header vault-controls__header">
          <div>
            <p className="eyebrow">Mind</p>
            <h2>{view === 'graph' ? 'Relationship map' : 'Capture library'}</h2>
          </div>
          <div className="vault-actions">
            <div className="vault-mode-tabs" aria-label="Mind view mode">
              <button className={view === 'list' ? 'button' : 'button-ghost'} onClick={() => setView('list')}>
                Cards
              </button>
              <button className={view === 'graph' ? 'button' : 'button-ghost'} onClick={() => setView('graph')}>
                Map
              </button>
            </div>
            <button className="button-secondary" onClick={clearVault}>
              Clear
            </button>
            <span className="tag-pill">{nodes.length} saved</span>
          </div>
        </div>

        <div className="vault-filterbar">
          <label className="form-row">
              <span className="field-label">Mind</span>
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                <option value="">Select Mind</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.workspaces.id} value={workspace.workspaces.id}>
                    {workspace.workspaces.name} ({workspace.role})
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span className="field-label">Search</span>
              <input
                placeholder="Search titles, tags, URLs, or summaries"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
        </div>

        <div className="vault-summary-row">
          <span>{workspaces.length} Minds</span>
          <span>{filteredNodes.length} shown</span>
          <span>{graphGroups.length} groups</span>
          <span>{status}</span>
        </div>
      </section>

      <section className={`vault-view vault-view--${view}`} aria-label={view === 'graph' ? 'Relationship map' : 'Saved captures'}>
        {view === 'graph' ? (
          filteredNodes.length > 0 ? (
            <GraphStage
              nodes={graphNodes}
              edges={graphEdges}
              selectedId={selectedGraphNode?.id ?? null}
              onSelect={(id) => setSelectedId(id)}
              onMoveNode={(id, x, y) => setLayoutOverrides((current) => ({ ...current, [id]: { x, y } }))}
              onResetLayout={resetLayout}
            />
          ) : (
            <div className="empty-state">Choose a Mind with captures to see the map.</div>
          )
        ) : filteredNodes.length > 0 ? (
          <div className="card-grid">
            {filteredNodes.map((node) => (
              <article key={node.id} className="card signal-card">
                <a
                  className="signal-card__media"
                  href={node.original_url ?? '#'}
                  target={node.original_url ? '_blank' : undefined}
                  rel={node.original_url ? 'noreferrer' : undefined}
                  aria-label={node.original_url ? `Open ${node.title ?? 'source link'}` : undefined}
                >
                  {node.og_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={node.og_image_url} alt={node.title ?? 'Link preview'} className="signal-card__thumb" />
                  ) : (
                    <div className="signal-card__thumb signal-card__thumb--fallback">
                      <span>{getHostLabel(node.original_url)}</span>
                    </div>
                  )}
                </a>

                <div className="signal-card__body">
                  <div className="signal-card__header">
                    <div>
                      <p className="kicker">Capture</p>
                      <h3>{node.title ?? 'Untitled'}</h3>
                    </div>
                    <span className="tag-pill">{getHostLabel(node.original_url)}</span>
                  </div>
                  <p className="meta">{node.source_description || node.ai_summary || 'Pending AI summary...'}</p>
                  {node.tags.length ? <p className="meta">Tags: {node.tags.join(', ')}</p> : null}
                  <div className="button-row">
                    {node.original_url ? (
                      <a className="button-ghost" href={node.original_url} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    ) : null}
                    <button className="button-secondary" onClick={() => setSelectedId(node.id)}>
                      Inspect
                    </button>
                    <button className="button-secondary" onClick={() => deleteCapture(node.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">Saved links will appear here after you choose a Mind.</div>
        )}
      </section>

      <section className="panel vault-detail" aria-label="Selection details">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Selected capture</p>
            <h2>Capture details</h2>
          </div>
          {selectedCapture?.original_url ? (
            <a className="button-secondary" href={selectedCapture.original_url} target="_blank" rel="noreferrer">
              Open Source
            </a>
          ) : null}
        </div>

        {selectedGraphNode ? (
          <div className="detail-grid">
            <div className="detail-card detail-card--main">
              <p className="kicker">
                {selectedCapture
                  ? getHostLabel(selectedCapture.original_url)
                  : selectedGraphNode.kind === 'core'
                    ? 'Mind'
                    : selectedGraphNode.metaKind === 'tag'
                      ? 'Tag'
                      : 'Source'}
              </p>
              <h3>{selectedGraphNode.label}</h3>
              <p className="meta">{selectedGraphNode.subtitle}</p>
              <div className="detail-stats">
                <div className="list-item">
                  <span className="kicker">Related</span>
                  <span className="metric-label">{selectedGraphNode.connectedIds.length}</span>
                </div>
                {selectedCapture ? (
                  <>
                    <div className="list-item">
                      <span className="kicker">Source</span>
                      <span className="metric-label">{getHostLabel(selectedCapture.original_url)}</span>
                    </div>
                    <div className="list-item">
                      <span className="kicker">Tags</span>
                      <span className="metric-label">
                        {selectedCapture.tags.length ? selectedCapture.tags.join(', ') : 'No tags yet.'}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <div className="detail-card detail-card--side">
              <p className="kicker">Related captures</p>
              {relatedCaptures.length ? (
                <div className="settings-list">
                  {relatedCaptures.slice(0, 6).map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className="list-item list-item--button"
                      onClick={() => setSelectedId(node.id)}
                    >
                      <span className="metric-label">{node.label}</span>
                      <span className="kicker">{getHostLabel(node.node?.original_url ?? null)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="meta">Pick a capture, source, or tag to see related captures here.</p>
              )}
              {selectedCapture ? (
                <div className="button-row">
                  {selectedCapture.original_url ? (
                    <a className="button-ghost" href={selectedCapture.original_url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : null}
                  <button className="button-secondary" onClick={() => deleteCapture(selectedCapture.id)}>
                    Delete Capture
                  </button>
                </div>
              ) : null}
              {relatedNodes.length ? (
                <div className="settings-list">
                  <p className="kicker">Semantic related</p>
                  {relatedNodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className="list-item list-item--button"
                      onClick={() => setSelectedId(node.id)}
                    >
                      <span className="metric-label">{node.title ?? 'Untitled'}</span>
                      <span className="kicker">
                        {Math.round(node.similarity * 100)}% match
                        {node.sharedTags.length ? ` · ${node.sharedTags.join(', ')}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="empty-state">Select a capture, source, or tag to inspect it here.</div>
        )}
      </section>
    </main>
  );
}

export default function VaultPage() {
  return (
    <AuthGate>
      <VaultContent />
    </AuthGate>
  );
}
