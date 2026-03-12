/**
 * api/server.js
 * Express REST API + WebSocket for real-time swarm execution.
 *
 * Routes:
 *   POST /api/swarms          — create and run a swarm job
 *   GET  /api/swarms/:id      — get job status + result
 *   GET  /api/topologies      — list available topologies + metrics
 *   POST /api/topologies/recommend — get topology recommendation
 *   GET  /api/agents          — list available agent roles
 *   GET  /api/health          — liveness check
 *
 * WebSocket: ws://host/ws
 *   Subscribe to real-time agent events during a job.
 */

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { Swarm } from "../coordination/swarm.js";
import { TOPOLOGY_FACTORIES } from "../topology/graph.js";
import { AGENT_FACTORIES } from "../agents/presets.js";
import { recommendTopology } from "../topology/search.js";

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

/** In-memory job store (replace with Redis/DB in production) */
const jobs = new Map();

/** Active WS subscribers per job: jobId → Set<ws> */
const subscribers = new Map();

function broadcast(jobId, event) {
  const subs = subscribers.get(jobId);
  if (!subs) return;
  const payload = JSON.stringify(event);
  for (const ws of subs) {
    if (ws.readyState === 1 /* OPEN */) ws.send(payload);
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

wss.on("connection", (ws) => {
  let subscribedJob = null;

  ws.on("message", (raw) => {
    try {
      const { type, jobId } = JSON.parse(raw);
      if (type === "subscribe" && jobId) {
        subscribedJob = jobId;
        if (!subscribers.has(jobId)) subscribers.set(jobId, new Set());
        subscribers.get(jobId).add(ws);
        ws.send(JSON.stringify({ type: "subscribed", jobId }));

        // Send current job state immediately
        const job = jobs.get(jobId);
        if (job) ws.send(JSON.stringify({ type: "job:state", job: sanitize(job) }));
      }
    } catch {
      /* ignore malformed messages */
    }
  });

  ws.on("close", () => {
    if (subscribedJob) subscribers.get(subscribedJob)?.delete(ws);
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/health */
app.get("/api/health", (_, res) => {
  res.json({ status: "ok", uptime: process.uptime(), jobs: jobs.size });
});

/** GET /api/agents */
app.get("/api/agents", (_, res) => {
  res.json({
    agents: Object.keys(AGENT_FACTORIES).map((role) => ({
      role,
      description: ROLE_DESCRIPTIONS[role] ?? "",
    })),
  });
});

/** GET /api/topologies */
app.get("/api/topologies", (_, res) => {
  res.json({
    topologies: Object.keys(TOPOLOGY_FACTORIES).map((name) => ({
      name,
      description: TOPOLOGY_DESCRIPTIONS[name] ?? "",
    })),
  });
});

/** POST /api/topologies/recommend */
app.post("/api/topologies/recommend", (req, res) => {
  const { agentCount, taskType } = req.body ?? {};
  if (!agentCount)
    return res.status(400).json({ error: "agentCount required" });
  const rec = recommendTopology(
    Number(agentCount),
    taskType ?? "unknown"
  );
  res.json(rec);
});

/**
 * POST /api/swarms
 * Body: {
 *   message: string,
 *   agents: string[],          // roles in order
 *   topology?: string,
 *   mode?: "pipeline"|"parallel"|"ensemble"|"graph-walk",
 *   rounds?: number,           // for graph-walk mode
 *   context?: object
 * }
 */
app.post("/api/swarms", async (req, res) => {
  const {
    message,
    agents: agentRoles,
    topology,
    mode = "pipeline",
    rounds = 3,
    context = {},
  } = req.body ?? {};

  if (!message) return res.status(400).json({ error: "message required" });
  if (!agentRoles?.length)
    return res.status(400).json({ error: "agents[] required" });

  // Validate roles
  for (const role of agentRoles) {
    if (!AGENT_FACTORIES[role])
      return res
        .status(400)
        .json({ error: `Unknown agent role: "${role}"` });
  }

  // Validate topology
  if (topology && !TOPOLOGY_FACTORIES[topology])
    return res.status(400).json({ error: `Unknown topology: "${topology}"` });

  const jobId = uuidv4();
  const job = {
    id: jobId,
    status: "running",
    createdAt: new Date().toISOString(),
    message,
    agentRoles,
    topology: topology ?? "auto",
    mode,
    events: [],
    result: null,
    error: null,
    stats: null,
  };
  jobs.set(jobId, job);

  // Respond immediately with job ID
  res.status(202).json({ jobId, status: "running" });

  // Run async
  (async () => {
    try {
      const builder = new Swarm().addAgents(agentRoles).withConcurrency(4);
      if (topology) builder.withTopology(topology);

      builder.on("agent:start", (e) => {
        const event = { type: "agent:start", ...e, ts: Date.now() };
        job.events.push(event);
        broadcast(jobId, event);
      });
      builder.on("agent:done", (e) => {
        const event = {
          type: "agent:done",
          ...e,
          outputPreview: e.output?.slice(0, 200),
          ts: Date.now(),
        };
        job.events.push(event);
        broadcast(jobId, event);
      });
      builder.on("message", (e) => {
        const event = { type: "message", ...e, ts: Date.now() };
        job.events.push(event);
        broadcast(jobId, event);
      });

      const swarm = builder.build();

      let result;
      if (mode === "parallel") {
        result = await swarm.runParallel(message, context);
      } else if (mode === "ensemble") {
        result = await swarm.runEnsemble(message, context);
      } else if (mode === "graph-walk") {
        result = await swarm.runGraphWalk(message, rounds);
      } else {
        result = await swarm.run(message, context);
      }

      job.status = "done";
      job.result = result;
      job.stats = result.stats;
      job.topology = swarm.getTopologyInfo();
    } catch (err) {
      job.status = "error";
      job.error = err.message;
    } finally {
      const event = { type: "job:complete", jobId, status: job.status };
      broadcast(jobId, event);
    }
  })();
});

/** GET /api/swarms/:id */
app.get("/api/swarms/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(sanitize(job));
});

/** GET /api/swarms */
app.get("/api/swarms", (_, res) => {
  const list = [...jobs.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50)
    .map(sanitize);
  res.json({ jobs: list });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(job) {
  // Avoid sending giant raw objects over the wire
  const j = { ...job };
  if (j.result?.outputs instanceof Map) {
    j.result = {
      ...j.result,
      outputs: Object.fromEntries(j.result.outputs),
    };
  }
  if (j.result?.individual instanceof Map) {
    j.result = {
      ...j.result,
      individual: Object.fromEntries(j.result.individual),
    };
  }
  return j;
}

const ROLE_DESCRIPTIONS = {
  planner: "Decomposes a goal into a structured step-by-step plan",
  researcher: "Gathers and synthesizes information on a topic",
  drafter: "Produces written content from a brief or research notes",
  critic: "Reviews work and provides scored structured feedback",
  verifier: "Fact-checks and validates claims or logic",
  summarizer: "Distills content into key points and action items",
};

const TOPOLOGY_DESCRIPTIONS = {
  pipeline: "Linear A→B→C chain. Best for sequential tasks.",
  "hub-and-spoke":
    "Central hub coordinates all spokes. Best for parallel tasks with a coordinator.",
  "full-mesh":
    "Every agent talks to every other. O(n²) cost — only for tiny n.",
  random:
    "Erdős–Rényi random graph. Strong baseline with path diversity (per K3n5jPkrU6).",
  "small-world":
    "Short average paths + clustering. Best for iterative refinement.",
};

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`\n🐝  swarm-cardinality API`);
  console.log(`   REST  → http://localhost:${PORT}/api`);
  console.log(`   WS    → ws://localhost:${PORT}/ws`);
  console.log(`   Docs  → http://localhost:${PORT}/api/health\n`);
});

export { app, server };
