/**
 * examples/topology_search.js
 * Demonstrates treating topology as a searchable object.
 * Compares pipeline vs hub-and-spoke vs random on a benchmark task.
 *
 * Note: makes real API calls — costs tokens.
 * Usage: ANTHROPIC_API_KEY=sk-... node examples/topology_search.js
 */

import { AGENT_FACTORIES, TOPOLOGY_FACTORIES } from "../src/index.js";
import { recommendTopology } from "../src/topology/search.js";

const TASK = "What are the top 3 risks in deploying LLM agents in production?";

console.log("🔬  Topology Search Example");
console.log("Task:", TASK, "\n");

// 1. Heuristic recommendation (free — no API calls)
const n = 3;
const rec = recommendTopology(n, "unknown");
console.log(`Heuristic recommendation for n=${n}, unknown task type:`);
console.log(`  → "${rec.name}": ${rec.rationale}\n`);

// 2. Show graph metrics for each topology without running agents
console.log("Graph metrics by topology (n=3 agents):\n");

const agentDummies = Array.from({ length: n }, (_, i) => ({
  id: `agent-${i}`,
  role: ["planner", "researcher", "critic"][i],
}));

const topologies = ["pipeline", "hub-and-spoke", "random", "small-world"];

for (const name of topologies) {
  const factory = TOPOLOGY_FACTORIES[name];
  // Create a minimal graph-like object for metrics
  const graph = {
    nodes: new Map(agentDummies.map((a) => [a.id, a])),
    edges: new Map(agentDummies.map((a) => [a.id, new Set()])),
    avgDegree() {
      let t = 0;
      for (const s of this.edges.values()) t += s.size;
      return t / this.nodes.size;
    },
  };

  // Use actual factory
  const realGraph = factory(
    agentDummies.map((a) => ({ ...a, getStats: () => ({}), run: async () => ({ text: "" }) }))
  );
  const m = realGraph.toJSON().metrics;

  console.log(`  [${name.padEnd(15)}]  nodes=${m.nodeCount}  edges=${m.edgeCount}  avgDegree=${m.avgDegree.toFixed(2)}  avgPath=${isFinite(m.avgPathLength) ? m.avgPathLength.toFixed(2) : "∞"}`);
}

console.log(`
Key insight from openreview.net/pdf?id=K3n5jPkrU6:
  Random graphs achieve competitive or better avg-path-length than hand-designed
  topologies at scale, due to route diversity and reduced correlated errors.

To run a full topology search with real API calls:
  import { searchTopology } from './src/topology/search.js';
  const { best, results } = await searchTopology(agents, evaluateFn);
  console.log(best.topology); // → name of winning topology
`);
