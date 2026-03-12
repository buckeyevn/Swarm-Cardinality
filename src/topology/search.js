/**
 * topology/search.js
 * Treats topology as a searchable object.
 *
 * Runs multiple topology variants in parallel, scores them on a simple
 * quality-vs-cost objective, and returns the best configuration.
 *
 * This is the concrete implementation of the paper's key recommendation:
 *   "Treat topology as a learnable or searchable object."
 */

import { TOPOLOGY_FACTORIES } from "./graph.js";

/**
 * Evaluate a single topology on a test task.
 * Returns {topology, score, cost, latency, graph}.
 *
 * @param {string}   topologyName
 * @param {Agent[]}  agents
 * @param {Function} runFn  - async (graph) => {quality:number, cost:number, latency:number}
 * @param {Object}   opts
 */
async function evaluateTopology(topologyName, agents, runFn, opts = {}) {
  const factory = TOPOLOGY_FACTORIES[topologyName];
  if (!factory) throw new Error(`Unknown topology: ${topologyName}`);

  const graph = factory(agents, ...Object.values(opts));
  const metrics = graph.toJSON().metrics;

  const start = Date.now();
  let quality = 0,
    cost = 0,
    error = null;

  try {
    const result = await runFn(graph);
    quality = result.quality ?? 0;
    cost = result.cost ?? 0;
  } catch (err) {
    error = err.message;
  }

  const latency = Date.now() - start;

  // Composite score: quality - cost_penalty - latency_penalty
  const score = error ? -1 : quality - cost * 0.1 - latency / 10000;

  return {
    topology: topologyName,
    score,
    quality,
    cost,
    latency,
    graphMetrics: metrics,
    error,
  };
}

/**
 * Search over a set of topologies and return ranked results.
 *
 * @param {Agent[]}  agents
 * @param {Function} runFn   - async (graph) => {quality, cost, latency}
 * @param {Object}   options
 * @param {string[]} [options.candidates] - which topologies to try
 * @param {boolean}  [options.parallel]  - run candidates concurrently
 * @returns {Promise<{best:Object, results:Object[]}>}
 */
export async function searchTopology(agents, runFn, options = {}) {
  const {
    candidates = ["pipeline", "hub-and-spoke", "random", "small-world"],
    parallel = true,
  } = options;

  let results;
  if (parallel) {
    results = await Promise.all(
      candidates.map((name) => evaluateTopology(name, agents, runFn))
    );
  } else {
    results = [];
    for (const name of candidates) {
      results.push(await evaluateTopology(name, agents, runFn));
    }
  }

  results.sort((a, b) => b.score - a.score);
  return { best: results[0], results };
}

/**
 * Quick heuristic: recommend a topology without running evaluations.
 * Useful as a starting point before search.
 *
 * @param {number} agentCount
 * @param {"sequential"|"parallel"|"iterative"|"unknown"} taskType
 * @returns {{name:string, rationale:string}}
 */
export function recommendTopology(agentCount, taskType) {
  if (agentCount <= 2) {
    return { name: "pipeline", rationale: "Trivial n — pipeline is optimal." };
  }

  if (taskType === "sequential") {
    return {
      name: "pipeline",
      rationale: "Sequential tasks map cleanly to a linear pipeline.",
    };
  }

  if (taskType === "parallel") {
    return {
      name: "hub-and-spoke",
      rationale:
        "Parallel independent tasks benefit from a central coordinator.",
    };
  }

  if (taskType === "iterative") {
    return {
      name: "small-world",
      rationale:
        "Iterative refinement benefits from short paths + clustering (small-world).",
    };
  }

  // Unknown: recommend random as the strong baseline from the paper
  return {
    name: "random",
    rationale:
      "Task type unknown — random graph is the strong baseline per K3n5jPkrU6.",
  };
}
