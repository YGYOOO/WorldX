import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { z } from "zod";
import { LLMClient } from "../dist/llm/llm-client.js";
import {
  flushAgentPond,
  shutdownAgentPond,
} from "../dist/telemetry/agentpond.js";

test("a WorldX LLM call emits an AgentPond trace", async () => {
  assert.equal(process.env.AGENTPOND_ENABLED, "true");
  assert.equal(process.env.FILES_SDK_PROVIDER, "fs");
  assert.ok(process.env.FILES_SDK_ROOT);

  const requests = [];
  const mockProvider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    requests.push({
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      url: request.url,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { content: '{"decision":"explore"}' } }],
        usage: { prompt_tokens: 9, completion_tokens: 4 },
      }),
    );
  });

  await new Promise((resolve) => {
    mockProvider.listen(0, "127.0.0.1", resolve);
  });
  const address = mockProvider.address();
  assert(address && typeof address === "object");

  try {
    const client = new LLMClient({
      provider: "openai-compatible",
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      apiKey: "test-key",
      defaultModel: "worldx-e2e-model",
    });
    const result = await client.call({
      messages: [{ role: "user", content: "Choose the next action." }],
      schema: z.object({ decision: z.string() }),
      options: {
        maxRetries: 0,
        structuredOutputMode: "prompt_only",
        taskType: "agentpond-e2e",
      },
    });

    assert.deepEqual(result.data, { decision: "explore" });
    assert.deepEqual(result.usage, {
      promptTokens: 9,
      completionTokens: 4,
      totalTokens: 13,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/v1/chat/completions");
    assert.equal(requests[0].authorization, "Bearer test-key");
    assert.equal(requests[0].body.model, "worldx-e2e-model");
    await flushAgentPond();
  } finally {
    await shutdownAgentPond();
    await new Promise((resolve, reject) => {
      mockProvider.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
