/**
 * examples/pipeline.js
 * Full research → draft → review pipeline.
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node examples/pipeline.js
 */

import { Swarm } from "../src/index.js";

const TASK =
  "Write a concise technical brief on the cardinality scaling hypothesis for multi-agent LLM systems — when adding more agents helps and when it backfires.";

console.log("🐝  Pipeline Example\n");
console.log("Task:", TASK, "\n");
console.log("─".repeat(60));

const swarm = new Swarm()
  .addAgents(["planner", "researcher", "drafter", "critic"])
  .withTopology("pipeline")
  .build();

// Stream agent events to console
swarm.on("agent:start", ({ role }) => {
  process.stdout.write(`\n[${role.toUpperCase()}] thinking…`);
});
swarm.on("agent:done", ({ role, output }) => {
  console.log(` ✓`);
  console.log(`  └─ ${output.slice(0, 120).replace(/\n/g, " ")}…`);
});

const { output, stats } = await swarm.run(TASK);

console.log("\n" + "─".repeat(60));
console.log("\n📄 FINAL OUTPUT:\n");
console.log(output);

console.log("\n" + "─".repeat(60));
console.log("\n📊 STATS:");
console.log(
  `  agents  : ${stats.agents.length}`
);
console.log(
  `  tokens  : ${stats.totalTokens.toLocaleString()} (in+out)`
);
console.log(`  messages: ${stats.totalMessages}`);
stats.agents.forEach((a) =>
  console.log(
    `  [${a.role.padEnd(12)}] calls=${a.calls} tokens=${a.inputTokens + a.outputTokens}`
  )
);
