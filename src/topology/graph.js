/**
 * topology/graph.js
 * Defines communication graph topologies for multi-agent swarms.
 *
 * Key insight (from openreview.net/pdf?id=K3n5jPkrU6):
 *   Random/irregular graphs often outperform hand-designed ones at scale
 *   due to path diversity and shorter average distances.
 *
 * This module makes topology a first-class, searchable object.
 */

/**
 * Adjacency-list graph representation.
 * nodes: Map<id, {id, role}>
 * edges: Map<id, Set<id>>  (directed: from → to)
 */
export class AgentGraph {
  constructor() {
    /** @type {Map<string, {id:string, role:string, agent:Object}>} */
    this.nodes = new Map();
    /** @type {Map<string, Set<string>>} */
    this.edges = new Map();
  }

  addNode(agent) {
    this.nodes.set(agent.id, { id: agent.id, role: agent.role, agent });
    this.edges.set(agent.id, new Set());
    return this;
  }

  addEdge(fromId, toId) {
    if (!this.nodes.has(fromId)) throw new Error(`Unknown node: ${fromId}`);
    if (!this.nodes.has(toId)) throw new Error(`Unknown node: ${toId}`);
    this.edges.get(fromId).add(toId);
    return this;
  }

  getNeighbors(nodeId) {
    return [...(this.edges.get(nodeId) ?? [])].map((id) => this.nodes.get(id));
  }

  /** Average out-degree (messages per agent per round) */
  avgDegree() {
    if (this.nodes.size === 0) return 0;
    let total = 0;
    for (const s of this.edges.values()) total += s.size;
    return total / this.nodes.size;
  }

  /** Average shortest path length (BFS from each node) */
  avgPathLength() {
    const ids = [...this.nodes.keys()];
    let total = 0;
    let count = 0;
    for (const src of ids) {
      const dist = this._bfs(src);
      for (const [dst, d] of dist) {
        if (dst !== src && d < Infinity) {
          total += d;
          count++;
        }
      }
    }
    return count === 0 ? Infinity : total / count;
  }

  _bfs(startId) {
    const dist = new Map([[startId, 0]]);
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of this.edges.get(cur) ?? []) {
        if (!dist.has(nb)) {
          dist.set(nb, dist.get(cur) + 1);
          queue.push(nb);
        }
      }
    }
    return dist;
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()].map(({ id, role }) => ({ id, role })),
      edges: [...this.edges.entries()].map(([from, tos]) => ({
        from,
        to: [...tos],
      })),
      metrics: {
        nodeCount: this.nodes.size,
        edgeCount: [...this.edges.values()].reduce((a, s) => a + s.size, 0),
        avgDegree: this.avgDegree(),
        avgPathLength: this.avgPathLength(),
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Topology factory functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hub-and-spoke: one hub receives from and broadcasts to all others.
 * O(n) edges. Simple, low chatter, but a bottleneck.
 */
export function hubAndSpoke(agents, hubIndex = 0) {
  const g = new AgentGraph();
  for (const a of agents) g.addNode(a);
  const ids = agents.map((a) => a.id);
  const hub = ids[hubIndex];
  for (const id of ids) {
    if (id !== hub) {
      g.addEdge(id, hub); // spoke → hub
      g.addEdge(hub, id); // hub → spoke
    }
  }
  return g;
}

/**
 * Linear pipeline: A → B → C → … → Z
 * O(n) edges. Good for sequential tasks.
 */
export function pipeline(agents) {
  const g = new AgentGraph();
  for (const a of agents) g.addNode(a);
  for (let i = 0; i < agents.length - 1; i++) {
    g.addEdge(agents[i].id, agents[i + 1].id);
  }
  return g;
}

/**
 * Full mesh (all-to-all): every agent talks to every other.
 * O(n²) edges — expensive, use only for tiny n.
 */
export function fullMesh(agents) {
  const g = new AgentGraph();
  for (const a of agents) g.addNode(a);
  const ids = agents.map((a) => a.id);
  for (const src of ids) {
    for (const dst of ids) {
      if (src !== dst) g.addEdge(src, dst);
    }
  }
  return g;
}

/**
 * Random Erdős–Rényi graph: each directed edge (i,j) exists with probability p.
 * Delivers the path-diversity benefits described in the paper.
 * @param {Agent[]} agents
 * @param {number}  p  - edge probability (0–1), default 0.4
 * @param {number}  seed - optional for reproducibility (simple LCG)
 */
export function randomGraph(agents, p = 0.4, seed = Date.now()) {
  const g = new AgentGraph();
  for (const a of agents) g.addNode(a);
  const ids = agents.map((a) => a.id);

  // Seeded pseudo-random (LCG)
  let s = seed % 2147483647;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  for (const src of ids) {
    for (const dst of ids) {
      if (src !== dst && rand() < p) g.addEdge(src, dst);
    }
  }
  return g;
}

/**
 * Small-world (Watts-Strogatz-inspired):
 * Start with a ring lattice (each node connected to k nearest neighbors),
 * then rewire each edge with probability beta.
 * Achieves short avg-path-length + high clustering — strong baseline.
 */
export function smallWorld(agents, k = 2, beta = 0.3, seed = Date.now()) {
  const n = agents.length;
  const g = new AgentGraph();
  for (const a of agents) g.addNode(a);
  const ids = agents.map((a) => a.id);

  // Ring lattice
  for (let i = 0; i < n; i++) {
    for (let j = 1; j <= k; j++) {
      g.addEdge(ids[i], ids[(i + j) % n]);
    }
  }

  // Rewire
  let s = seed % 2147483647;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const randInt = (max) => Math.floor(rand() * max);

  for (let i = 0; i < n; i++) {
    for (let j = 1; j <= k; j++) {
      if (rand() < beta) {
        const newDst = ids[randInt(n)];
        if (newDst !== ids[i] && !g.edges.get(ids[i]).has(newDst)) {
          g.edges.get(ids[i]).delete(ids[(i + j) % n]);
          g.addEdge(ids[i], newDst);
        }
      }
    }
  }
  return g;
}

export const TOPOLOGY_FACTORIES = {
  "hub-and-spoke": hubAndSpoke,
  pipeline,
  "full-mesh": fullMesh,
  random: randomGraph,
  "small-world": smallWorld,
};
