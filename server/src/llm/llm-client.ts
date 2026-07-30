import { ZodSchema } from "zod";
import { generateId } from "../utils/id-generator.js";
import { logCall, calculateCost } from "./cost-tracker.js";
import type { LLMConfig, LLMCallOptions, LLMCallResult, LLMCallLog } from "../types/index.js";
import type { Message } from "./prompt-builder.js";
import {
  resolveStructuredOutputMode,
  getStructuredOutputAttemptModes,
  isUnsupportedJsonModeError,
  parsePossiblyMalformedJSON,
  type StructuredOutputMode,
} from "./structured-output.js";
import { withAgentPondLLMSpan } from "../telemetry/agentpond.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const NETWORK_RETRY_DELAY_MS = 1_000;
const MAX_NETWORK_RETRIES = 2;
const DEFAULT_STRUCTURED_OUTPUT_MODE = resolveStructuredOutputMode(
  undefined,
  process.env.SIMULATION_STRUCTURED_OUTPUT_MODE,
);
const structuredOutputCapabilityCache = new Map<string, StructuredOutputMode>();

function getRequestTimeoutMs(overrideMs?: number): number {
  if (Number.isFinite(overrideMs) && (overrideMs ?? 0) > 0) {
    return overrideMs as number;
  }

  const n = Number(process.env.SIMULATION_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REQUEST_TIMEOUT_MS;
}

export class LLMClient {
  private config: LLMConfig;

  constructor(config?: LLMConfig) {
    this.config = config ?? buildConfigFromEnv();
  }

  async call<T>(params: {
    messages: Message[];
    schema: ZodSchema<T>;
    options: LLMCallOptions;
  }): Promise<LLMCallResult<T>> {
    const { options } = params;
    const model = this.resolveModel(options);
    return withAgentPondLLMSpan(
      {
        model,
        taskType: options.taskType,
      },
      () => this.executeCall(params, model),
    );
  }

  private async executeCall<T>(
    params: {
      messages: Message[];
      schema: ZodSchema<T>;
      options: LLMCallOptions;
    },
    model: string,
  ): Promise<LLMCallResult<T>> {
    const { schema, options } = params;
    const maxRetries = options.maxRetries ?? 2;
    const messages = [...params.messages];
    const structuredOutputMode = resolveStructuredOutputMode(
      options.structuredOutputMode,
      process.env.SIMULATION_STRUCTURED_OUTPUT_MODE,
      DEFAULT_STRUCTURED_OUTPUT_MODE,
    );

    const startTime = Date.now();
    let lastError: Error | null = null;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let rawText: string;
      let usage: { prompt_tokens: number; completion_tokens: number };

      try {
        const response = await this.sendStructuredRequest(
          messages,
          model,
          options.temperature,
          options.timeoutMs,
          structuredOutputMode,
        );
        rawText = response.text;
        usage = response.usage;
        totalPromptTokens += usage.prompt_tokens;
        totalCompletionTokens += usage.completion_tokens;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Network-level retry
        let networkRetries = 0;
        let success = false;
        while (networkRetries < MAX_NETWORK_RETRIES) {
          networkRetries++;
          await sleep(NETWORK_RETRY_DELAY_MS);
          try {
            const response = await this.sendStructuredRequest(
              messages,
              model,
              options.temperature,
              options.timeoutMs,
              structuredOutputMode,
            );
            rawText = response.text;
            usage = response.usage;
            totalPromptTokens += usage.prompt_tokens;
            totalCompletionTokens += usage.completion_tokens;
            success = true;
            break;
          } catch {
            // continue retry
          }
        }
        if (!success) {
          const duration = Date.now() - startTime;
          this.logResult(options, model, totalPromptTokens, totalCompletionTokens, duration, false, lastError.message);
          throw lastError;
        }
      }

      let json: unknown;
      try {
        json = parsePossiblyMalformedJSON(rawText!);
      } catch {
        if (attempt < maxRetries) {
          messages.push({ role: "assistant", content: rawText! });
          messages.push({
            role: "user",
            content: `你的上一次输出格式不正确。无法从中提取有效的JSON。\n请严格按照要求的 JSON 格式重新输出，不要包含任何多余文字。`,
          });
          continue;
        }
        const duration = Date.now() - startTime;
        this.logResult(options, model, totalPromptTokens, totalCompletionTokens, duration, false, "Failed to extract JSON from response");
        throw new Error("Failed to extract JSON from LLM response after retries");
      }

      const parseResult = schema.safeParse(json);
      if (parseResult.success) {
        const duration = Date.now() - startTime;
        this.logResult(options, model, totalPromptTokens, totalCompletionTokens, duration, true);
        return {
          data: parseResult.data,
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
          },
          model,
          durationMs: duration,
        };
      }

      if (attempt < maxRetries) {
        const errorDesc = parseResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        messages.push({ role: "assistant", content: rawText! });
        messages.push({
          role: "user",
          content: `你的上一次输出格式不正确。错误信息：${errorDesc}\n请严格按照要求的 JSON 格式重新输出，不要包含任何多余文字。`,
        });
      } else {
        lastError = new Error(
          `Zod validation failed: ${parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
      }
    }

    const duration = Date.now() - startTime;
    this.logResult(options, model, totalPromptTokens, totalCompletionTokens, duration, false, lastError?.message);
    throw lastError ?? new Error("LLM call failed after all retries");
  }

  private resolveModel(options: LLMCallOptions): string {
    if (options.model) return options.model;
    if (this.config.modelOverrides?.[options.taskType]) {
      return this.config.modelOverrides[options.taskType];
    }
    return this.config.defaultModel;
  }

  private async sendRequest(
    messages: Message[],
    model: string,
    temperature?: number,
    timeoutMs?: number,
    responseFormatType?: "json_object",
  ): Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
    const url = `${this.config.baseURL}/chat/completions`;

    const controller = new AbortController();
    const effectiveTimeoutMs = getRequestTimeoutMs(timeoutMs);
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    try {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (temperature !== undefined) {
        body.temperature = temperature;
      }
      if (responseFormatType) {
        body.response_format = { type: responseFormatType };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`LLM API error ${res.status}: ${errBody}`);
      }

      const data = (await res.json()) as {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

      const text = data.choices?.[0]?.message?.content ?? "";
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };

      return { text, usage };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`LLM request timed out after ${effectiveTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async sendStructuredRequest(
    messages: Message[],
    model: string,
    temperature?: number,
    timeoutMs?: number,
    structuredOutputMode: StructuredOutputMode = DEFAULT_STRUCTURED_OUTPUT_MODE,
  ): Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
    const capabilityKey = `${this.config.baseURL}::${model}`;
    const attemptModes = getStructuredOutputAttemptModes(
      structuredOutputMode,
      structuredOutputCapabilityCache.get(capabilityKey),
    );

    let lastError: Error | null = null;

    for (const mode of attemptModes) {
      try {
        return await this.sendRequest(
          messages,
          model,
          temperature,
          timeoutMs,
          mode === "json_object" ? "json_object" : undefined,
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (mode === "json_object" && isUnsupportedJsonModeError(lastError)) {
          structuredOutputCapabilityCache.set(capabilityKey, "prompt_only");
          if (structuredOutputMode === "auto") {
            continue;
          }
        }

        if (structuredOutputMode === "auto" && mode === "json_object") {
          continue;
        }

        break;
      }
    }

    throw lastError ?? new Error("Structured LLM request failed");
  }

  private logResult(
    options: LLMCallOptions,
    model: string,
    promptTokens: number,
    completionTokens: number,
    durationMs: number,
    success: boolean,
    error?: string,
  ): void {
    try {
      const cost = calculateCost(promptTokens, completionTokens);
      const log: LLMCallLog = {
        id: generateId(),
        taskType: options.taskType,
        characterId: options.characterId,
        model,
        promptTokens,
        completionTokens,
        cost,
        durationMs,
        success,
        error,
        createdAt: new Date().toISOString(),
      };
      logCall(log);
    } catch {
      // DB not available during some tests — silently ignore
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildConfigFromEnv(): LLMConfig {
  return {
    provider: "openai-compatible",
    baseURL: process.env.SIMULATION_BASE_URL ?? "https://openrouter.ai/api/v1",
    apiKey: process.env.SIMULATION_API_KEY ?? "",
    defaultModel: process.env.SIMULATION_MODEL ?? "google/gemini-2.5-flash-preview",
  };
}
