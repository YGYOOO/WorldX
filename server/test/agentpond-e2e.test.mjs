import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
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
    const requestBody = requests.at(-1).body;
    const shouldFail = requestBody.messages.some(
      (message) => message.content === "Trigger a private provider error.",
    );
    response.writeHead(shouldFail ? 500 : 200, {
      "content-type": "application/json",
    });
    response.end(
      shouldFail
        ? "Provider echoed private prompt: Trigger a private provider error."
        : JSON.stringify({
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
    await assert.rejects(
      client.call({
        messages: [
          { role: "user", content: "Trigger a private provider error." },
        ],
        schema: z.object({ decision: z.string() }),
        options: {
          maxRetries: 0,
          structuredOutputMode: "prompt_only",
          taskType: "agentpond-error-e2e",
        },
      }),
      /LLM API error 500/,
    );

    // The error call exercises each supported structured-output transport.
    assert.equal(requests.length, 4);
    assert.equal(requests[0].url, "/v1/chat/completions");
    assert.equal(requests[0].authorization, "Bearer test-key");
    assert.equal(requests[0].body.model, "worldx-e2e-model");
    await flushAgentPond();

    const objectFiles = await findJsonFiles(process.env.FILES_SDK_ROOT);
    assert.ok(objectFiles.length > 0);
    const rawObjects = await Promise.all(
      objectFiles.map((file) => readFile(file, "utf8")),
    );
    const rawTrace = rawObjects.join("\n");
    const exported = rawObjects.flatMap((object) => JSON.parse(object));
    const spans = exported.flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) => scope.spans),
    );
    assert.equal(spans.length, 2);
    assert.equal(spans[0].name, "worldx.llm.call");
    assert.equal(spans[0].traceId.length, 32);
    const attributes = Object.fromEntries(
      spans[0].attributes.map((attribute) => [
        attribute.key,
        attribute.value.stringValue ??
          Number(attribute.value.intValue),
      ]),
    );
    assert.equal(attributes["openinference.span.kind"], "LLM");
    assert.equal(attributes["llm.model_name"], "worldx-e2e-model");
    assert.equal(attributes["llm.token_count.total"], 13);
    assert.equal(rawTrace.includes("Choose the next action."), false);
    assert.equal(rawTrace.includes("Trigger a private provider error."), false);
    assert.equal(rawTrace.includes("Provider echoed private prompt"), false);
    const errorSpan = spans.find((span) => span.status.code === 2);
    assert.ok(errorSpan);
    const errorAttributes = Object.fromEntries(
      errorSpan.attributes.map((attribute) => [
        attribute.key,
        attribute.value.stringValue,
      ]),
    );
    assert.equal(errorAttributes["error.type"], "LLMOperationError");
    assert.equal(errorSpan.status.message, "LLM operation failed");
  } finally {
    await shutdownAgentPond();
    await new Promise((resolve, reject) => {
      mockProvider.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function findJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findJsonFiles(path)));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".json") &&
      !entry.name.endsWith(".meta.json")
    ) {
      files.push(path);
    }
  }
  return files;
}
