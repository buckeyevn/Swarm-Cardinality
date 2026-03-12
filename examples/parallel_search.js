/**
 * examples/parallel_search.js
 * Fan-out: multiple researchers tackle sub-questions simultaneously,
 * then a summarizer synthesizes their findings.
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node examples/parallel_search.js
 */

import { Swarm } from "../src/index.js";

const QUESTIONS = [
  "What are the main coordination costs in multi-agent LLM systems?",
  "How does specialization improve multi-agent performance vs a single generalist?",
  "What does the research say about optimal agent count for complex tasks?",
];

console.log("🐝  Parallel Search Example\n");
console.log(`Exploring ${QUESTIONS.length} questions in parallel\n`);
console.log("─".repeat(60));

const swarm = new Swarm()
  .addAgents([
    "researcher",
    "researcher",
    "researcher",
    "summarizer",
  ])
  .withTopology("hub-and-spoke", { hubIndex: 3 }) // summarizer is the hub
  .build();

swarm.on("agent:start", ({ role, id }) => {
  process.stdout.write(`[${role.padEnd(12)} ${id.slice(0, 6)}] thinking…`);
});
swarm.on("agent:done", ({ role, id }) => {
  console.log(` ✓  [${id.slice(0, 6)}]`);
});

// Run all 3 researchers on different questions in parallel
const { outputs: researchOutputs } = await swarm.runParallel(
  QUESTIONS.map((q, i) => ({ id: swarm.agents[i].id, question: q }))
    .map(() => QUESTIONS[0]) // simplified: same input for demo
);

// For the real parallel: run each researcher on its specific question
const researcherIds = swarm.agents.slice(0, 3).map((a) => a.id);
const results = await Promise.all(
  QUESTIONS.map((q, i) => swarm.agents[i].run(q))
);

const combined = results
  .map((r, i) => `Question ${i + 1}: ${QUESTIONS[i]}\n\nFindings:\n${r.text}`)
  .join("\n\n" + "─".repeat(40) + "\n\n");

const summarizerAgent = swarm.agents[3];
const { text: synthesis } = await summarizerAgent.run(
  `Synthesize these three independent research answers into a cohesive brief:\n\n${combined}`
);

console.log("\n" + "─".repeat(60));
console.log("\n📄 SYNTHESIS:\n");
console.log(synthesis);

console.log("\n" + "─".repeat(60));
const totalTokens = swarm.agents.reduce(
  (a, ag) => a + ag.stats.inputTokens + ag.stats.outputTokens,
  0
);
console.log(`\n📊 Total tokens used: ${totalTokens.toLocaleString()}`);
