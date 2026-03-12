/**
 * tests/topology.test.js
 * Unit tests for the topology graph module.
 */

import {
  AgentGraph,
  hubAndSpoke,
  pipeline,
  fullMesh,
  randomGraph,
  smallWorld,
} from "../src/topology/graph.js";

// Minimal mock agents
function mockAgents(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    role: `role${i}`,
    getStats: () => ({}),
    run: async () => ({ text: "" }),
    reset: () => {},
    memory: [],
    on: () => {},
  }));
}

// ── AgentGraph ────────────────────────────────────────────────────────────────

test("AgentGraph: addNode and addEdge", () => {
  const g = new AgentGraph();
  const a = { id: "a", role: "r" };
  const b = { id: "b", role: "r" };
  g.addNode(a).addNode(b).addEdge("a", "b");
  expect(g.nodes.size).toBe(2);
  expect(g.edges.get("a").has("b")).toBe(true);
  expect(g.edges.get("b").has("a")).toBe(false);
});

test("AgentGraph: addEdge throws on unknown nodes", () => {
  const g = new AgentGraph();
  expect(() => g.addEdge("x", "y")).toThrow("Unknown node");
});

test("AgentGraph: avgDegree empty graph is 0", () => {
  expect(new AgentGraph().avgDegree()).toBe(0);
});

test("AgentGraph: toJSON shape", () => {
  const g = new AgentGraph();
  g.addNode({ id: "a", role: "planner" }).addNode({ id: "b", role: "critic" });
  g.addEdge("a", "b");
  const j = g.toJSON();
  expect(j).toHaveProperty("nodes");
  expect(j).toHaveProperty("edges");
  expect(j).toHaveProperty("metrics");
  expect(j.metrics.edgeCount).toBe(1);
});

// ── Pipeline ──────────────────────────────────────────────────────────────────

test("pipeline: n=1 has 0 edges", () => {
  const g = pipeline(mockAgents(1));
  expect(g.toJSON().metrics.edgeCount).toBe(0);
});

test("pipeline: n=4 has 3 edges and correct order", () => {
  const agents = mockAgents(4);
  const g = pipeline(agents);
  const m = g.toJSON().metrics;
  expect(m.edgeCount).toBe(3);
  // Each node except the last has exactly one out-edge
  for (let i = 0; i < 3; i++) {
    expect(g.edges.get(agents[i].id).has(agents[i + 1].id)).toBe(true);
  }
  expect(g.edges.get(agents[3].id).size).toBe(0);
});

test("pipeline: avgPathLength is n-1 for n=3", () => {
  const agents = mockAgents(3);
  const g = pipeline(agents);
  // 0→1: 1, 0→2: 2, 1→2: 1 — paths only forward
  const apl = g.avgPathLength();
  expect(apl).toBeCloseTo(4 / 3, 5); // (1+2+1)/3
});

// ── Hub-and-Spoke ─────────────────────────────────────────────────────────────

test("hubAndSpoke: n=4 has 2*(n-1)=6 edges", () => {
  const g = hubAndSpoke(mockAgents(4));
  expect(g.toJSON().metrics.edgeCount).toBe(6);
});

test("hubAndSpoke: hub has out-degree n-1", () => {
  const agents = mockAgents(4);
  const g = hubAndSpoke(agents, 0);
  expect(g.edges.get(agents[0].id).size).toBe(3);
});

// ── Full Mesh ─────────────────────────────────────────────────────────────────

test("fullMesh: n=3 has 6 directed edges", () => {
  const g = fullMesh(mockAgents(3));
  expect(g.toJSON().metrics.edgeCount).toBe(6);
});

test("fullMesh: no self-loops", () => {
  const agents = mockAgents(4);
  const g = fullMesh(agents);
  for (const [id, tos] of g.edges) {
    expect(tos.has(id)).toBe(false);
  }
});

// ── Random Graph ──────────────────────────────────────────────────────────────

test("randomGraph: p=0 has 0 edges", () => {
  const g = randomGraph(mockAgents(5), 0, 42);
  expect(g.toJSON().metrics.edgeCount).toBe(0);
});

test("randomGraph: p=1 has n*(n-1) edges (full mesh)", () => {
  const n = 4;
  const g = randomGraph(mockAgents(n), 1, 42);
  expect(g.toJSON().metrics.edgeCount).toBe(n * (n - 1));
});

test("randomGraph: same seed produces same graph", () => {
  const agents1 = mockAgents(5);
  const agents2 = agents1.map((a) => ({ ...a })); // same IDs
  const g1 = randomGraph(agents1, 0.5, 99);
  const g2 = randomGraph(agents2, 0.5, 99);
  expect(g1.toJSON().metrics.edgeCount).toBe(g2.toJSON().metrics.edgeCount);
});

// ── Small World ───────────────────────────────────────────────────────────────

test("smallWorld: n=5, k=1, beta=0 has exactly n edges (ring)", () => {
  const g = smallWorld(mockAgents(5), 1, 0, 0);
  expect(g.toJSON().metrics.edgeCount).toBe(5);
});

test("smallWorld: n=6, k=2, beta=0 has n*k=12 edges", () => {
  const g = smallWorld(mockAgents(6), 2, 0, 0);
  expect(g.toJSON().metrics.edgeCount).toBe(12);
});

// ── Topology recommendation ───────────────────────────────────────────────────

import { recommendTopology } from "../src/topology/search.js";

test("recommendTopology: n=1 → pipeline", () => {
  expect(recommendTopology(1, "unknown").name).toBe("pipeline");
});

test("recommendTopology: sequential → pipeline", () => {
  expect(recommendTopology(5, "sequential").name).toBe("pipeline");
});

test("recommendTopology: parallel → hub-and-spoke", () => {
  expect(recommendTopology(5, "parallel").name).toBe("hub-and-spoke");
});

test("recommendTopology: iterative → small-world", () => {
  expect(recommendTopology(5, "iterative").name).toBe("small-world");
});

test("recommendTopology: unknown → random (paper baseline)", () => {
  expect(recommendTopology(5, "unknown").name).toBe("random");
});
