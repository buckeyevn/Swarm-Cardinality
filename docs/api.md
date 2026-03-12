# API Reference

## REST Endpoints

Base URL: `http://localhost:3000`

---

### `GET /api/health`

Liveness check.

**Response:**
```json
{ "status": "ok", "uptime": 42.1, "jobs": 3 }
```

---

### `GET /api/agents`

List all available agent roles.

**Response:**
```json
{
  "agents": [
    { "role": "planner",    "description": "Decomposes a goal into a structured plan" },
    { "role": "researcher", "description": "Gathers and synthesizes information" },
    { "role": "drafter",    "description": "Produces written content" },
    { "role": "critic",     "description": "Reviews work and scores it" },
    { "role": "verifier",   "description": "Fact-checks and validates" },
    { "role": "summarizer", "description": "Distills content to key points" }
  ]
}
```

---

### `GET /api/topologies`

List all available topology types.

**Response:**
```json
{
  "topologies": [
    { "name": "pipeline",       "description": "Linear A→B→C chain." },
    { "name": "hub-and-spoke",  "description": "Central coordinator." },
    { "name": "full-mesh",      "description": "All-to-all. O(n²)." },
    { "name": "random",         "description": "Erdős–Rényi. Strong baseline." },
    { "name": "small-world",    "description": "Short paths + clustering." }
  ]
}
```

---

### `POST /api/topologies/recommend`

Heuristic topology recommendation.

**Request:**
```json
{
  "agentCount": 4,
  "taskType": "sequential"
}
```

`taskType`: `"sequential"` | `"parallel"` | `"iterative"` | `"unknown"`

**Response:**
```json
{ "name": "pipeline", "rationale": "Sequential tasks map cleanly to a linear pipeline." }
```

---

### `POST /api/swarms`

Create and run a swarm job. Returns immediately with a job ID.

**Request:**
```json
{
  "message": "string (required)",
  "agents": ["planner", "researcher", "drafter"],
  "topology": "pipeline",
  "mode": "pipeline",
  "rounds": 3,
  "context": {}
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `message` | string | ✅ | — | The task/prompt |
| `agents` | string[] | ✅ | — | Ordered list of agent roles |
| `topology` | string | — | auto | Topology name |
| `mode` | string | — | `"pipeline"` | Execution mode |
| `rounds` | number | — | `3` | Rounds for `graph-walk` mode |
| `context` | object | — | `{}` | Extra context passed to all agents |

**Modes:**

| Mode | Behavior |
|---|---|
| `pipeline` | Agents run sequentially, output flows forward |
| `parallel` | All agents run simultaneously on the same message |
| `ensemble` | All-but-last run in parallel, last synthesizes |
| `graph-walk` | Messages propagate through graph for N rounds |

**Response (202):**
```json
{ "jobId": "uuid", "status": "running" }
```

---

### `GET /api/swarms/:id`

Get job status and result.

**Response:**
```json
{
  "id": "uuid",
  "status": "running | done | error",
  "createdAt": "ISO timestamp",
  "message": "original task",
  "agentRoles": ["planner", "researcher"],
  "topology": {
    "name": "pipeline",
    "nodes": [{ "id": "uuid", "role": "planner" }],
    "edges": [{ "from": "uuid", "to": ["uuid2"] }],
    "metrics": {
      "nodeCount": 2,
      "edgeCount": 1,
      "avgDegree": 0.5,
      "avgPathLength": 1.0
    }
  },
  "result": {
    "output": "Final output text...",
    "outputs": { "agent-uuid": "..." }
  },
  "stats": {
    "agents": [
      { "id": "uuid", "role": "planner", "model": "claude-sonnet-4-6",
        "calls": 1, "inputTokens": 500, "outputTokens": 200, "errors": 0 }
    ],
    "totalMessages": 1,
    "totalTokens": 700
  },
  "events": [
    { "type": "agent:start", "id": "uuid", "role": "planner", "ts": 1234567890 }
  ],
  "error": null
}
```

---

### `GET /api/swarms`

List recent jobs (up to 50).

---

## WebSocket

### Connect

```
ws://localhost:3000/ws
```

### Subscribe to a job

```json
→ { "type": "subscribe", "jobId": "uuid" }
← { "type": "subscribed", "jobId": "uuid" }
← { "type": "job:state", "job": { ... } }   // current state immediately
```

### Event types received

| Type | Fields | Description |
|---|---|---|
| `agent:start` | `id, role, round?` | Agent began processing |
| `agent:done` | `id, role, outputPreview, ts` | Agent finished |
| `message` | `from, to, messagePreview, ts` | Message passed between agents |
| `job:complete` | `jobId, status` | Job finished (done/error) |

---

## SDK

```js
import {
  Swarm,
  Agent,
  AgentGraph,
  pipeline, hubAndSpoke, randomGraph, smallWorld, fullMesh,
  TOPOLOGY_FACTORIES, AGENT_FACTORIES,
  recommendTopology, searchTopology,
  Orchestrator,
} from './src/index.js';
```

### `Swarm` (builder)

```js
const swarm = new Swarm()
  .addAgents(['planner', 'researcher'])   // required
  .withTopology('pipeline')               // optional, auto-selects if omitted
  .withConcurrency(4)                     // max parallel API calls
  .withMaxRounds(10)                      // circuit breaker
  .build();                               // → SwarmInstance
```

### `SwarmInstance`

```js
await swarm.run(message, context)          // pipeline mode
await swarm.runParallel(message, context)  // fan-out
await swarm.runEnsemble(message, context)  // ensemble
await swarm.runGraphWalk(message, rounds)  // graph-walk

swarm.getTopologyInfo()  // → { name, nodes, edges, metrics }
swarm.resetAll()         // clear agent memories
```

### `AgentGraph`

```js
const g = new AgentGraph();
g.addNode(agent).addNode(agent2).addEdge(agent.id, agent2.id);
g.getNeighbors(nodeId)   // → [{ id, role, agent }]
g.avgDegree()            // → number
g.avgPathLength()        // → number (BFS)
g.toJSON()               // → { nodes, edges, metrics }
```
