# swarm-cardinality

**Multi-agent orchestration framework — cardinality as a first-class scaling knob.**

by [Minh Pham](https://github.com/minhpham)

---

## Core Idea

Cardinality belongs next to parameters, data, and context as a **first-class scaling knob**. Multiple specialized agents — planner, researcher, drafter, critic, verifier — can outperform a single generalist via specialization, iteration, and ensemble effects.

The win lives or dies on **coordination economics**: how agents communicate, what state they share, and how expensive it is to keep them aligned.

---

## Architecture

```
swarm-cardinality/
├── src/
│   ├── agents/
│   │   ├── base.js          # Agent class: model, memory, stats, tool dispatch
│   │   └── presets.js       # Planner, Researcher, Drafter, Critic, Verifier, Summarizer
│   ├── topology/
│   │   ├── graph.js         # AgentGraph + 5 topology factories
│   │   └── search.js        # Topology search + heuristic recommender
│   ├── coordination/
│   │   ├── orchestrator.js  # Pipeline / Parallel / Ensemble / Graph-walk runtime
│   │   └── swarm.js         # High-level builder API + SwarmInstance
│   ├── api/
│   │   └── server.js        # Express REST API + WebSocket live events
│   ├── dashboard/
│   │   ├── index.html       # Live topology visualizer + event feed
│   │   └── serve.js         # Static server for dashboard
│   └── index.js             # Public exports
├── examples/
│   ├── pipeline.js          # Sequential research → draft → review
│   ├── parallel_search.js   # Fan-out researchers + synthesizer
│   └── topology_search.js   # Topology comparison + metrics
├── tests/
│   └── topology.test.js     # 20+ unit tests for graph module
└── docs/
    └── api.md               # Full API reference
```

---

## Quick Start

```bash
# Install
npm install

# Set API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run the API server
npm start
# → REST: http://localhost:3000/api
# → WS:   ws://localhost:3000/ws

# Open the dashboard (separate terminal)
npm run dashboard
# → http://localhost:8080

# Run examples
node examples/pipeline.js
node examples/topology_search.js
```

---

## SDK Usage

### Pipeline (simplest)

```js
import { Swarm } from './src/index.js';

const swarm = new Swarm()
  .addAgents(['planner', 'researcher', 'drafter', 'critic'])
  .withTopology('pipeline')
  .build();

const { output, stats } = await swarm.run(
  'Write a brief on quantum error correction'
);

console.log(output);
console.log(`Tokens used: ${stats.totalTokens}`);
```

### Parallel Fan-out

```js
const swarm = new Swarm()
  .addAgents(['researcher', 'researcher', 'researcher', 'summarizer'])
  .withTopology('hub-and-spoke')
  .build();

const { outputs } = await swarm.runParallel(task);
```

### Ensemble

```js
const swarm = new Swarm()
  .addAgents(['researcher', 'researcher', 'critic', 'summarizer'])
  .withTopology('random')
  .build();

// Workers run independently, summarizer synthesizes
const { synthesis } = await swarm.runEnsemble(task);
```

### Graph-Walk (random topology)

```js
const swarm = new Swarm()
  .addAgents(['planner', 'researcher', 'drafter', 'critic', 'verifier'])
  .withTopology('random', { p: 0.4 })
  .build();

const { roundOutputs } = await swarm.runGraphWalk(task, 3);
```

### Live Events

```js
swarm.on('agent:start', ({ role }) => console.log(`${role} thinking…`));
swarm.on('agent:done',  ({ role, output }) => console.log(`${role}: ${output}`));
```

---

## Topology Reference

| Name | Edges | Best For | Notes |
|---|---|---|---|
| `pipeline` | O(n) | Sequential tasks | A→B→C→D |
| `hub-and-spoke` | O(n) | Parallel + coordinator | Hub aggregates all |
| `full-mesh` | O(n²) | Tiny n only | Expensive — avoid at scale |
| `random` | ~p·n² | Unknown task type | **Strong baseline** per K3n5jPkrU6 |
| `small-world` | O(n·k) | Iterative refinement | Short paths + clustering |

### Topology as a Searchable Object

```js
import { recommendTopology } from './src/topology/search.js';

const { name, rationale } = recommendTopology(agentCount, taskType);
// taskType: 'sequential' | 'parallel' | 'iterative' | 'unknown'
```

**Key insight** ([openreview.net/pdf?id=K3n5jPkrU6](https://openreview.net/pdf?id=K3n5jPkrU6)):
Irregular/random communication graphs can outperform hand-designed topologies at scale due to path diversity and shorter average distances. Don't overfit to one beautiful chart — treat topology as a searchable hyperparameter.

---

## REST API

### `POST /api/swarms`

Run a swarm job asynchronously.

```json
{
  "message": "Analyze the risks of deploying LLM agents in production",
  "agents": ["planner", "researcher", "drafter", "critic"],
  "topology": "pipeline",
  "mode": "pipeline"
}
```

**Modes:** `pipeline` | `parallel` | `ensemble` | `graph-walk`

Returns `{ jobId, status: "running" }` immediately.

### `GET /api/swarms/:id`

Poll job status and result.

```json
{
  "id": "uuid",
  "status": "done",
  "result": { "output": "..." },
  "stats": {
    "totalTokens": 4821,
    "totalMessages": 6,
    "agents": [...]
  }
}
```

### `GET /api/agents`

List available agent roles.

### `GET /api/topologies`

List available topologies.

### `POST /api/topologies/recommend`

```json
{ "agentCount": 4, "taskType": "sequential" }
→ { "name": "pipeline", "rationale": "..." }
```

### WebSocket: `ws://host/ws`

Subscribe to real-time events:

```js
ws.send(JSON.stringify({ type: 'subscribe', jobId: '...' }));
// Receive: agent:start | agent:done | message | job:complete
```

---

## Agent Model Ladder

Agents are matched to the smallest model that meets quality requirements:

| Agent | Model | Rationale |
|---|---|---|
| planner | claude-sonnet-4-6 | Needs structured reasoning |
| researcher | claude-haiku-4-5 | High-volume, fast lookups |
| drafter | claude-sonnet-4-6 | Quality writing |
| critic | claude-sonnet-4-6 | Nuanced evaluation |
| verifier | claude-haiku-4-5 | Binary checks — fast + cheap |
| summarizer | claude-haiku-4-5 | Distillation — fast + cheap |

Override any agent's model:

```js
import { createDrafter } from './src/agents/presets.js';
const strongDrafter = createDrafter({ model: 'claude-opus-4-6' });
```

---

## When to Add Agents

**✅ Add agents when:**
- The task decomposes cleanly (research → plan → draft → review → test → ship)
- Tool use benefits from parallel probing that a single agent would serialize
- Tasks have heterogeneous quality requirements — match each to the smallest sufficient model

**❌ It backfires when:**
- You allow naive all-to-all chat — O(n²) messages drown in latency and cost
- Roles exist just because — if there's no measured lift, merge or delete

---

## Tests

```bash
npm test
```

Covers: AgentGraph CRUD, all 5 topology factories, path-length metrics, topology recommender.

---

## License

MIT — Minh Pham
