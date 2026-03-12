/**
 * src/index.js
 * Public API surface for swarm-cardinality.
 */

export { Agent } from "./agents/base.js";
export {
  createPlanner,
  createResearcher,
  createDrafter,
  createCritic,
  createVerifier,
  createSummarizer,
  AGENT_FACTORIES,
} from "./agents/presets.js";

export {
  AgentGraph,
  hubAndSpoke,
  pipeline,
  fullMesh,
  randomGraph,
  smallWorld,
  TOPOLOGY_FACTORIES,
} from "./topology/graph.js";

export { searchTopology, recommendTopology } from "./topology/search.js";

export { Orchestrator } from "./coordination/orchestrator.js";
export { Swarm, SwarmInstance } from "./coordination/swarm.js";
