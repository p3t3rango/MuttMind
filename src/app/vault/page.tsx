'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

type Workspace = {
  role: string;
  workspaces: { id: string; name: string };
};

type GraphNode = {
  id: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  created_at: string;
};

type NodeDetail = {
  id: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  ai_summary: string | null;
  source_description: string | null;
  source_author: string | null;
  user_notes: string | null;
  created_by_label?: string;
  created_at?: string;
  tags: string[];
};

type GraphEdge = {
  from: string;
  to: string;
  weight: number;
};

type SimNode = SimulationNodeDatum & GraphNode;
type SimEdge = SimulationLinkDatum<SimNode> & { weight: number };

function getHostLabel(url: string | null) {
  if (!url) return 'source';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function VaultContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [, forceRender] = useState(0);

  // Viewport (for the SVG): pan + zoom. Maintained as a ref so we can update
  // smoothly during pointer moves without re-rendering on every event.
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const draggedNodeRef = useRef<SimNode | null>(null);
  // Tracks whether the active node interaction has moved enough to count as a
  // drag (vs. a click). Set on pointerdown, flipped true once movement exceeds
  // the threshold. Without this, every node press registered as a drag and
  // clicks never opened anything.
  const nodeGestureRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const panRef = useRef<{ active: boolean; startX: number; startY: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 1200, height: 800 });

  const loadWorkspaces = useCallback(async () => {
    const r = await authedFetch('/api/workspaces');
    const d = await r.json();
    const next = (d.workspaces ?? []) as Workspace[];
    setWorkspaces(next);
    setWorkspaceId((current) => {
      if (current) return current;
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem('muttmind:active-mind-id') : null;
      return stored ?? next[0]?.workspaces?.id ?? '';
    });
  }, []);

  const loadGraph = useCallback(async (id: string) => {
    if (!id) return;
    setIsLoading(true);
    const r = await authedFetch(`/api/nodes/graph?workspaceId=${id}`);
    const d = await r.json();
    setGraphNodes((d.nodes ?? []) as GraphNode[]);
    setGraphEdges((d.edges ?? []) as GraphEdge[]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (workspaceId) loadGraph(workspaceId);
  }, [workspaceId, loadGraph]);

  // Track stage size so the simulation centers correctly.
  useEffect(() => {
    const observe = () => {
      if (!stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    };
    observe();
    window.addEventListener('resize', observe);
    return () => window.removeEventListener('resize', observe);
  }, []);

  // Build / rebuild the d3 simulation when nodes or edges change.
  useEffect(() => {
    simulationRef.current?.stop();
    if (graphNodes.length === 0) {
      simNodesRef.current = [];
      simEdgesRef.current = [];
      forceRender((n) => n + 1);
      return;
    }

    const center = { x: stageSize.width / 2, y: stageSize.height / 2 };
    const sim: SimNode[] = graphNodes.map((n) => ({
      ...n,
      x: center.x + (Math.random() - 0.5) * 80,
      y: center.y + (Math.random() - 0.5) * 80,
    }));
    const nodeById = new Map(sim.map((n) => [n.id, n] as const));
    const links: SimEdge[] = graphEdges
      .filter((e) => nodeById.has(e.from) && nodeById.has(e.to))
      .map((e) => ({ source: nodeById.get(e.from)!, target: nodeById.get(e.to)!, weight: e.weight }));

    simNodesRef.current = sim;
    simEdgesRef.current = links;

    const simulation = forceSimulation<SimNode, SimEdge>(sim)
      .force('charge', forceManyBody().strength(-180))
      .force('link', forceLink<SimNode, SimEdge>(links).id((d) => d.id).distance((d) => 90 + (1 - d.weight) * 80).strength(0.45))
      .force('collide', forceCollide<SimNode>().radius(28))
      .force('center', forceCenter(center.x, center.y))
      .alphaDecay(0.025)
      .on('tick', () => forceRender((n) => n + 1));

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [graphNodes, graphEdges, stageSize.width, stageSize.height]);

  // Adjacency for hover highlighting.
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graphEdges) {
      if (!m.has(e.from)) m.set(e.from, new Set());
      if (!m.has(e.to)) m.set(e.to, new Set());
      m.get(e.from)!.add(e.to);
      m.get(e.to)!.add(e.from);
    }
    return m;
  }, [graphEdges]);

  // URL ?q= filtering — fade non-matching nodes.
  const matchedIds = useMemo(() => {
    if (!query) return null;
    const set = new Set<string>();
    for (const n of graphNodes) {
      const haystack = `${n.title ?? ''} ${getHostLabel(n.original_url)}`.toLowerCase();
      if (haystack.includes(query)) set.add(n.id);
    }
    return set;
  }, [graphNodes, query]);

  // Pointer handlers for pan + drag.
  const onSvgPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    panRef.current = {
      active: true,
      startX: event.clientX - transformRef.current.x,
      startY: event.clientY - transformRef.current.y,
    };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };

  const onSvgPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    // If a node press is in progress, decide drag-vs-click based on movement.
    const gesture = nodeGestureRef.current;
    if (gesture) {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (!gesture.moved && Math.hypot(dx, dy) > 4) {
        gesture.moved = true;
        const node = simNodesRef.current.find((n) => n.id === gesture.id);
        if (node) {
          draggedNodeRef.current = node;
          node.fx = node.x;
          node.fy = node.y;
          simulationRef.current?.alphaTarget(0.3).restart();
        }
      }
      const dragged = draggedNodeRef.current;
      if (dragged) {
        const pt = svgClientToWorld(event.clientX, event.clientY);
        dragged.fx = pt.x;
        dragged.fy = pt.y;
      }
      return;
    }
    const pan = panRef.current;
    if (!pan?.active) return;
    transformRef.current = {
      ...transformRef.current,
      x: event.clientX - pan.startX,
      y: event.clientY - pan.startY,
    };
    setTransform({ ...transformRef.current });
  };

  const onSvgPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = nodeGestureRef.current;
    if (gesture) {
      if (gesture.moved) {
        // Was a drag — release the fixed position.
        if (draggedNodeRef.current) {
          draggedNodeRef.current.fx = null;
          draggedNodeRef.current.fy = null;
          draggedNodeRef.current = null;
          simulationRef.current?.alphaTarget(0);
        }
      } else {
        // No movement — it's a click. Open the node.
        setSelectedId((current) => (current === gesture.id ? null : gesture.id));
      }
      nodeGestureRef.current = null;
    }
    if (panRef.current) panRef.current.active = false;
    try {
      (event.currentTarget as Element).releasePointerCapture(event.pointerId);
    } catch {
      /* no-op */
    }
  };

  const svgClientToWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const t = transformRef.current;
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const t = transformRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    const nextK = Math.min(3, Math.max(0.3, t.k * factor));
    const ratio = nextK / t.k;
    transformRef.current = {
      x: localX - (localX - t.x) * ratio,
      y: localY - (localY - t.y) * ratio,
      k: nextK,
    };
    setTransform({ ...transformRef.current });
  };

  // Native wheel listener (React's onWheel is passive in some browsers).
  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    const handler = (e: WheelEvent) => onWheel(e);
    node.addEventListener('wheel', handler, { passive: false });
    return () => node.removeEventListener('wheel', handler);
  }, []);

  // Pointer-down on a node only RECORDS the gesture. Whether it becomes a
  // drag or a click is decided in onSvgPointerMove / onSvgPointerUp based on
  // whether the pointer actually moved. Capture stays on the SVG so the
  // move/up handlers there see the whole gesture.
  const onNodePointerDown = (node: SimNode) => (event: ReactPointerEvent<SVGGElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    nodeGestureRef.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    panRef.current = null;
    const svg = svgRef.current;
    if (svg) {
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        /* no-op */
      }
    }
  };

  const openInDashboard = (id: string) => {
    if (workspaceId) {
      window.localStorage.setItem('muttmind:active-mind-id', workspaceId);
    }
    window.localStorage.setItem('muttmind:focus-capture-id', id);
    router.push('/dashboard');
  };

  // When a node is selected, fetch its full detail so the map can show the
  // whole capture (summary, tags, notes) without bouncing to the dashboard.
  useEffect(() => {
    if (!selectedId || !workspaceId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      const r = await authedFetch(
        `/api/nodes/${encodeURIComponent(selectedId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      if (cancelled) return;
      if (r.ok) {
        const d = await r.json();
        setDetail((d.node ?? null) as NodeDetail | null);
      } else {
        setDetail(null);
      }
      setDetailLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, workspaceId]);

  return (
    <main className="app-shell vault-shell">
      <AppNav active="vault" />

      <section className="vault-page">
        <header className="vault-page__top">
          <div className="vault-page__crumb">
            <Link href="/minds" className="vault-page__crumb-link">minds</Link>
            <span className="vault-page__crumb-sep">/</span>
            <span>{graphNodes.length} {graphNodes.length === 1 ? 'capture' : 'captures'}</span>
            {graphEdges.length ? (
              <>
                <span className="vault-page__crumb-sep">·</span>
                <span>{graphEdges.length} {graphEdges.length === 1 ? 'connection' : 'connections'}</span>
              </>
            ) : null}
          </div>
          <nav className="vault-page__pivots" aria-label="View">
            <Link href="/minds" className="vault-page__pivot">Minds</Link>
            <Link href="/dashboard" className="vault-page__pivot">Dashboard</Link>
            <span className="vault-page__pivot vault-page__pivot--active">Map</span>
            {workspaceId ? (
              <Link href={`/minds/${workspaceId}/essays`} className="vault-page__pivot">
                Insights
              </Link>
            ) : null}
          </nav>
        </header>

        <div className="vault-stage" ref={stageRef}>
          {isLoading ? (
            <p className="vault-stage__hint">Loading graph…</p>
          ) : graphNodes.length === 0 ? (
            <p className="vault-stage__hint">This Mind has no captures yet.</p>
          ) : null}

          <svg
            ref={svgRef}
            className="vault-svg"
            width={stageSize.width}
            height={stageSize.height}
            onPointerDown={onSvgPointerDown}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerLeave={onSvgPointerUp}
            style={{ cursor: panRef.current?.active ? 'grabbing' : 'grab' }}
          >
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
              {/* Edges */}
              {simEdgesRef.current.map((edge, i) => {
                const a = edge.source as SimNode;
                const b = edge.target as SimNode;
                if (typeof a.x !== 'number' || typeof b.x !== 'number') return null;
                const isFaded = hoveredId !== null && hoveredId !== a.id && hoveredId !== b.id;
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={`vault-edge ${isFaded ? 'vault-edge--faded' : ''}`}
                    strokeWidth={Math.max(0.5, edge.weight * 1.4)}
                  />
                );
              })}

              {/* Nodes */}
              {simNodesRef.current.map((node) => {
                if (typeof node.x !== 'number' || typeof node.y !== 'number') return null;
                const connected = adjacency.get(node.id);
                const degree = connected?.size ?? 0;
                const isHovered = hoveredId === node.id;
                const isNeighbor = hoveredId !== null && (connected?.has(hoveredId) ?? false);
                const isFaded =
                  (hoveredId !== null && !isHovered && !isNeighbor) ||
                  (matchedIds !== null && !matchedIds.has(node.id));
                const isSelected = selectedId === node.id;
                // Radius scales with connection count (Obsidian-style), capped.
                const baseRadius = 4 + Math.min(degree, 12) * 0.85;
                const radius = isHovered || isSelected ? baseRadius + 2.5 : baseRadius;
                const label = node.title?.trim() || getHostLabel(node.original_url);
                const shortLabel = label.length > 42 ? `${label.slice(0, 42)}…` : label;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x},${node.y})`}
                    className={`vault-node ${isFaded ? 'vault-node--faded' : ''} ${isSelected ? 'vault-node--selected' : ''}`}
                    onPointerDown={onNodePointerDown(node)}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <circle r={radius} className="vault-node__circle" />
                    <text
                      y={radius + 13}
                      className={`vault-node__label ${isHovered || isSelected ? 'vault-node__label--strong' : ''}`}
                      textAnchor="middle"
                    >
                      {shortLabel}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {selectedId ? (
            <aside className="vault-detail" role="complementary">
              <button
                type="button"
                className="vault-detail__close"
                onClick={() => setSelectedId(null)}
                aria-label="Close detail"
              >
                ×
              </button>

              {detailLoading && !detail ? (
                <p className="vault-detail__loading">Loading capture…</p>
              ) : detail ? (
                <div className="vault-detail__scroll">
                  {detail.og_image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={detail.og_image_url} alt="" className="vault-detail__image" />
                  ) : null}
                  <p className="vault-detail__host">{getHostLabel(detail.original_url)}</p>
                  <h2 className="vault-detail__title">{detail.title ?? 'Untitled'}</h2>

                  {detail.ai_summary || detail.source_description ? (
                    <div className="vault-detail__block">
                      <p className="vault-detail__kicker">TLDR</p>
                      <p className="vault-detail__body">
                        {detail.ai_summary || detail.source_description}
                      </p>
                    </div>
                  ) : null}

                  {detail.tags.length ? (
                    <div className="vault-detail__block">
                      <p className="vault-detail__kicker">Tags</p>
                      <div className="vault-detail__tags">
                        {detail.tags.map((t) => (
                          <span key={t} className="vault-detail__tag">{t}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {detail.user_notes ? (
                    <div className="vault-detail__block">
                      <p className="vault-detail__kicker">Notes</p>
                      <p className="vault-detail__body">{detail.user_notes}</p>
                    </div>
                  ) : null}

                  <p className="vault-detail__meta">
                    Added by {detail.created_by_label ?? 'teammate'}
                  </p>

                  <div className="vault-detail__actions">
                    {detail.original_url ? (
                      <a
                        className="vault-detail__action"
                        href={detail.original_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Visit source
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="vault-detail__action vault-detail__action--ghost"
                      onClick={() => openInDashboard(detail.id)}
                    >
                      Edit in dashboard
                    </button>
                  </div>
                </div>
              ) : (
                <p className="vault-detail__loading">Could not load this capture.</p>
              )}
            </aside>
          ) : null}

          <div className="vault-stage__legend" aria-hidden="true">
            <span>drag to pan · scroll to zoom · drag a node to rearrange</span>
          </div>
        </div>

        <Workspaces
          workspaces={workspaces}
          workspaceId={workspaceId}
          onChange={(id) => {
            setSelectedId(null);
            setWorkspaceId(id);
          }}
        />
      </section>
    </main>
  );
}

function Workspaces({
  workspaces,
  workspaceId,
  onChange,
}: {
  workspaces: Workspace[];
  workspaceId: string;
  onChange: (id: string) => void;
}) {
  if (workspaces.length <= 1) return null;
  return (
    <div className="vault-mind-row">
      <span className="vault-mind-row__label">Mind:</span>
      <select
        className="vault-mind-row__select"
        value={workspaceId}
        onChange={(event) => onChange(event.target.value)}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.workspaces.id} value={workspace.workspaces.id}>
            {workspace.workspaces.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function VaultPage() {
  return (
    <AuthGate>
      <VaultContent />
    </AuthGate>
  );
}
