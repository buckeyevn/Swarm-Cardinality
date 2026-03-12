/**
 * coordination/swarm.js
 * High-level builder API: the main entry point for users.
 *
 * Example:
 *   const swarm = new Swarm()
 *     .addAgents(['planner','researcher','drafter','critic'])
 *     .withTopology('pipeline')
 *     .build();
 *
 *   const result = await swarm.run('Write a brief on quantum computing');
 */

import { AGENT_FACTORIES } from "../agents/presets.js";
import { TOPOLOGY_FACTORIES } from "../topology/graph.js";
import { recommendTopology } from "../topology/search.js";
import { Orchestrator } from "./orchestrator.js";
import { EventEmitter } from "events";

export class Swarm extends EventEmitter {
  constructor() {
    super();
    this._agentConfigs = []; // [{role, overrides}]
    this._topologyName = null;
    this._topologyOpts = {};
    this._concurrency = 4;
    this._maxRounds = 10;
    this._built = false;
  }

  /**
   * @param {string[]|string} roles  - e.g. ['planner','researcher']
   */
  addAgents(roles, overrides = {}) {
    const list = Array.isArray(roles) ? roles : [roles];
    for (const role of list) {
      if (!AGENT_FACTORIES[role])
        throw new Error(
          `Unknown agent role: "${role}". Available: ${Object.keys(AGENT_FACTORIES).join(", ")}`
        );
      this._agentConfigs.push({ role, overrides });
    }
    return this;
  }

  withTopology(name, opts = {}) {
    if (!TOPOLOGY_FACTORIES[name])
      throw new Error(
        `Unknown topology: "${name}". Available: ${Object.keys(TOPOLOGY_FACTORIES).join(", ")}`
      );
    this._topologyName = name;
    this._topologyOpts = opts;
    return this;
  }

  withConcurrency(n) {
    this._concurrency = n;
    return this;
  }

  withMaxRounds(n) {
    this._maxRounds = n;
    return this;
  }

  /**
   * Build and return a ready-to-run SwarmInstance.
   * If no topology is specified, auto-recommends based on agent count.
   */
  build() {
    if (this._agentConfigs.length === 0)
      throw new Error("Swarm must have at least one agent.");

    // Instantiate agents
    const agents = this._agentConfigs.map(({ role, overrides }) =>
      AGENT_FACTORIES[role](overrides)
    );

    // Auto-select topology if not specified
    if (!this._topologyName) {
      const rec = recommendTopology(agents.length, "unknown");
      this._topologyName = rec.name;
      console.log(
        `[Swarm] Auto-selected topology "${this._topologyName}": ${rec.rationale}`
      );
    }

    // Build graph
    const factory = TOPOLOGY_FACTORIES[this._topologyName];
    const graph = factory(agents, ...Object.values(this._topologyOpts));

    const orchestrator = new Orchestrator(graph, {
      concurrency: this._concurrency,
      maxRounds: this._maxRounds,
    });

    // Bubble events
    orchestrator.on("agent:start", (e) => this.emit("agent:start", e));
    orchestrator.on("agent:done", (e) => this.emit("agent:done", e));
    orchestrator.on("message", (e) => this.emit("message", e));

    this._built = true;

    return new SwarmInstance(agents, graph, orchestrator, this._topologyName);
  }
}

/**
 * A built, ready-to-run swarm.
 */
export class SwarmInstance extends EventEmitter {
  constructor(agents, graph, orchestrator, topologyName) {
    super();
    this.agents = agents;
    this.graph = graph;
    this.orchestrator = orchestrator;
    this.topologyName = topologyName;

    orchestrator.on("agent:start", (e) => this.emit("agent:start", e));
    orchestrator.on("agent:done", (e) => this.emit("agent:done", e));
    orchestrator.on("message", (e) => this.emit("message", e));
  }

  /**
   * Run the swarm using pipeline mode (default).
   * Entry = first agent in build order.
   */
  async run(message, context = {}) {
    const entryId = this.agents[0].id;
    const { outputs, log } = await this.orchestrator.runPipeline(
      entryId,
      message,
      context
    );
    const stats = this.orchestrator.getStats();
    const lastOutput =
      outputs.get(this.agents[this.agents.length - 1].id) ?? "";
    return { output: lastOutput, outputs, log, stats };
  }

  /** Fan-out all agents in parallel, return all outputs. */
  async runParallel(message, context = {}) {
    const ids = this.agents.map((a) => a.id);
    const results = await this.orchestrator.runParallel(ids, message, context);
    return { outputs: results, stats: this.orchestrator.getStats() };
  }

  /** Ensemble: all but last agent work in parallel, last synthesizes. */
  async runEnsemble(message, context = {}) {
    if (this.agents.length < 2) throw new Error("Ensemble needs ≥ 2 agents.");
    const workers = this.agents.slice(0, -1).map((a) => a.id);
    const aggregator = this.agents[this.agents.length - 1].id;
    const result = await this.orchestrator.runEnsemble(
      workers,
      aggregator,
      message,
      context
    );
    return { ...result, stats: this.orchestrator.getStats() };
  }

  /** Graph-walk mode for random/small-world topologies. */
  async runGraphWalk(message, rounds = 3) {
    const entryId = this.agents[0].id;
    const result = await this.orchestrator.runGraphWalk(
      entryId,
      message,
      rounds
    );
    return { ...result, stats: this.orchestrator.getStats() };
  }

  getTopologyInfo() {
    return {
      name: this.topologyName,
      ...this.graph.toJSON(),
    };
  }

  resetAll() {
    for (const a of this.agents) a.reset();
    this.orchestrator.log = [];
  }
}
