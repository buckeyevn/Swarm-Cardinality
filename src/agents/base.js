/**
 * agents/base.js
 * Abstract base class for all agents in the swarm.
 * Each agent has a role, a model assignment, tools, and message memory.
 */

import Anthropic from "@anthropic-ai/sdk";
import { EventEmitter } from "events";

const client = new Anthropic();

export class Agent extends EventEmitter {
  /**
   * @param {Object} config
   * @param {string} config.id          - Unique agent ID
   * @param {string} config.role        - Human-readable role label (e.g. "planner")
   * @param {string} config.model       - Anthropic model string
   * @param {string} config.systemPrompt
   * @param {Array}  [config.tools]     - Anthropic tool definitions
   * @param {number} [config.maxTokens]
   */
  constructor({ id, role, model, systemPrompt, tools = [], maxTokens = 1024 }) {
    super();
    this.id = id;
    this.role = role;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.maxTokens = maxTokens;

    /** @type {Array<{role:string, content:string}>} */
    this.memory = [];

    this.stats = { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0 };
  }

  /**
   * Run one turn: append user message, call API, store assistant reply.
   * @param {string} userMessage
   * @param {Object} [context]  - Optional structured context merged into message
   * @returns {Promise<{text:string, raw:Object}>}
   */
  async run(userMessage, context = {}) {
    const fullMessage =
      Object.keys(context).length > 0
        ? `${userMessage}\n\n<context>${JSON.stringify(context, null, 2)}</context>`
        : userMessage;

    this.memory.push({ role: "user", content: fullMessage });

    const requestParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.systemPrompt,
      messages: this.memory,
    };

    if (this.tools.length > 0) {
      requestParams.tools = this.tools;
    }

    this.emit("thinking", { agentId: this.id, role: this.role });

    let response;
    try {
      response = await client.messages.create(requestParams);
      this.stats.calls++;
      this.stats.inputTokens += response.usage.input_tokens;
      this.stats.outputTokens += response.usage.output_tokens;
    } catch (err) {
      this.stats.errors++;
      this.emit("error", { agentId: this.id, error: err.message });
      throw err;
    }

    // Handle tool use in a simple loop (single round for now)
    let finalText = "";
    if (response.stop_reason === "tool_use") {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const result = await this._dispatchTool(block.name, block.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Second turn with tool results
      this.memory.push({ role: "assistant", content: response.content });
      this.memory.push({ role: "user", content: toolResults });

      const response2 = await client.messages.create({
        ...requestParams,
        messages: this.memory,
      });
      this.stats.calls++;
      this.stats.inputTokens += response2.usage.input_tokens;
      this.stats.outputTokens += response2.usage.output_tokens;
      finalText = response2.content.find((b) => b.type === "text")?.text ?? "";
      this.memory.push({ role: "assistant", content: finalText });
    } else {
      finalText = response.content.find((b) => b.type === "text")?.text ?? "";
      this.memory.push({ role: "assistant", content: finalText });
    }

    this.emit("done", { agentId: this.id, role: this.role, text: finalText });
    return { text: finalText, raw: response };
  }

  /**
   * Override in subclasses to handle tool dispatch.
   * @param {string} toolName
   * @param {Object} input
   * @returns {Promise<any>}
   */
  async _dispatchTool(toolName, input) {
    throw new Error(`Tool "${toolName}" not implemented on agent "${this.role}"`);
  }

  /** Clear conversation memory (keep system prompt). */
  reset() {
    this.memory = [];
  }

  getStats() {
    return { ...this.stats, id: this.id, role: this.role, model: this.model };
  }
}
