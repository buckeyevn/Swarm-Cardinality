/**
 * coordination/orchestrator.js
 * Core runtime: routes messages between agents according to a topology graph.
 *
 * Implements the three coordination primitives:
 *   1. Sequential  — pipeline execution (one at a time)
 *   2. Parallel    — fan-out to all neighbors simultaneously
 *   3. Ensemble    — collect N independent answers, then synthesize
 */

import { EventEmitter } from "events";
import pLimit from "p-limit";

export class Orchestrator extends EventEmitter {
  /**
   * @param {AgentGraph} graph
   * @param {Object}     options
   * @param {number}     [options.concurrency] - max parallel agent calls
   * @param {number}     [options.maxRounds]   - circuit-breaker
   */
  constructor(graph, { concurrency = 4, maxRounds = 10 } = {}) {
    super();
    this.graph = graph;
    this.limit = pLimit(concurrency);
    this.maxRounds = maxRounds;

    /** Message log for observability */
    this.log = [];
  }

  _record(from, to, message, result) {
    const entry = {
      timestamp: new Date().toISOString(),
      from,
      to,
      messagePreview: message.slice(0, 120),
      resultPreview: result?.slice(0, 120),
    };
    this.log.push(entry);
    this.emit("message", entry);
  }

  /**
   * Execute a pipeline: run agents in graph order, passing output forward.
   * Assumes the graph is a DAG (no cycles enforced here).
   *
   * @param {string} entryNodeId - start node
   * @param {string} initialMessage
   * @param {Object} [context]
   * @returns {Promise<{outputs: Map<string, string>, log: Array}>}
   */
  async runPipeline(entryNodeId, initialMessage, context = {}) {
    const visited = new Set();
    const outputs = new Map();
    const queue = [{ nodeId: entryNodeId, message: initialMessage }];
    let rounds = 0;

    while (queue.length > 0 && rounds < this.maxRounds) {
      const { nodeId, message } = queue.shift();
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      rounds++;

      const node = this.graph.nodes.get(nodeId);
      if (!node) continue;

      this.emit("agent:start", { id: nodeId, role: node.role, round: rounds });

      const { text } = await node.agent.run(message, context);
      outputs.set(nodeId, text);

      this.emit("agent:done", { id: nodeId, role: node.role, output: text });

      for (const neighbor of this.graph.getNeighbors(nodeId)) {
        if (!visited.has(neighbor.id)) {
          this._record(nodeId, neighbor.id, message, text);
          queue.push({ nodeId: neighbor.id, message: text });
        }
      }
    }

    return { outputs, log: this.log };
  }

  /**
   * Fan-out: send the same message to multiple agents in parallel,
   * collect all results.
   *
   * @param {string[]} nodeIds
   * @param {string}   message
   * @param {Object}   [context]
   * @returns {Promise<Map<string, string>>}
   */
  async runParallel(nodeIds, message, context = {}) {
    const results = new Map();

    await Promise.all(
      nodeIds.map((id) =>
        this.limit(async () => {
          const node = this.graph.nodes.get(id);
          if (!node) return;

          this.emit("agent:start", { id, role: node.role });
          const { text } = await node.agent.run(message, context);
          results.set(id, text);
          this.emit("agent:done", { id, role: node.role, output: text });
        })
      )
    );

    return results;
  }

  /**
   * Ensemble: run N agents independently on the same problem,
   * then synthesize with a final aggregator agent.
   *
   * @param {string[]}  nodeIds       - worker agents
   * @param {string}    aggregatorId  - synthesis agent
   * @param {string}    message
   * @param {Object}    [context]
   * @returns {Promise<{individual: Map<string, string>, synthesis: string}>}
   */
  async runEnsemble(nodeIds, aggregatorId, message, context = {}) {
    const individual = await this.runParallel(nodeIds, message, context);

    const aggregatorNode = this.graph.nodes.get(aggregatorId);
    if (!aggregatorNode) throw new Error(`Aggregator ${aggregatorId} not found`);

    const combinedInput = [
      `You received ${individual.size} independent analyses. Synthesize them into one coherent answer.`,
      "",
      ...[...individual.entries()].map(
        ([id, text], i) =>
          `--- Agent ${i + 1} (${this.graph.nodes.get(id)?.role ?? id}) ---\n${text}`
      ),
    ].join("\n");

    this.emit("agent:start", {
      id: aggregatorId,
      role: aggregatorNode.role,
      mode: "ensemble-aggregator",
    });
    const { text: synthesis } = await aggregatorNode.agent.run(
      combinedInput,
      context
    );
    this.emit("agent:done", {
      id: aggregatorId,
      role: aggregatorNode.role,
      output: synthesis,
    });

    return { individual, synthesis };
  }

  /**
   * Graph walk: propagate messages through the graph for R rounds.
   * Each agent receives aggregated outputs of its predecessors.
   * Implements the random-graph communication pattern from the paper.
   *
   * @param {string}  entryNodeId
   * @param {string}  initialMessage
   * @param {number}  rounds
   * @returns {Promise<{roundOutputs: Array, finalOutputs: Map}>}
   */
  async runGraphWalk(entryNodeId, initialMessage, rounds = 3) {
    /** @type {Map<string, string>} latest output per node */
    let currentMessages = new Map([[entryNodeId, initialMessage]]);
    const roundOutputs = [];

    for (let r = 0; r < rounds; r++) {
      /** @type {Map<string, string[]>} nodeId → incoming messages */
      const inbox = new Map();

      // Deliver outgoing messages to neighbors
      for (const [srcId, msg] of currentMessages) {
        for (const neighbor of this.graph.getNeighbors(srcId)) {
          if (!inbox.has(neighbor.id)) inbox.set(neighbor.id, []);
          inbox.get(neighbor.id).push(msg);
          this._record(srcId, neighbor.id, msg, null);
        }
      }

      if (inbox.size === 0) break;

      // Run all receiving agents in parallel
      const nextMessages = new Map();
      await Promise.all(
        [...inbox.entries()].map(([nodeId, msgs]) =>
          this.limit(async () => {
            const node = this.graph.nodes.get(nodeId);
            if (!node) return;

            const combined =
              msgs.length === 1
                ? msgs[0]
                : `You received ${msgs.length} messages:\n\n${msgs.map((m, i) => `[${i + 1}] ${m}`).join("\n\n")}`;

            this.emit("agent:start", {
              id: nodeId,
              role: node.role,
              round: r + 1,
            });
            const { text } = await node.agent.run(combined);
            nextMessages.set(nodeId, text);
            this.emit("agent:done", {
              id: nodeId,
              role: node.role,
              round: r + 1,
              output: text,
            });
          })
        )
      );

      currentMessages = nextMessages;
      roundOutputs.push({ round: r + 1, outputs: Object.fromEntries(nextMessages) });
    }

    return { roundOutputs, finalOutputs: currentMessages };
  }

  getStats() {
    const agentStats = [...this.graph.nodes.values()].map(({ agent }) =>
      agent.getStats()
    );
    const totalTokens = agentStats.reduce(
      (a, s) => a + s.inputTokens + s.outputTokens,
      0
    );
    return {
      agents: agentStats,
      totalMessages: this.log.length,
      totalTokens,
      graphMetrics: this.graph.toJSON().metrics,
    };
  }
}
