import { createFilesSpanExporterFromRuntimeEnv } from "@agentpond/files-sdk/otel";
import {
  SpanStatusCode,
  trace,
  type Attributes,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { LLMCallResult } from "../types/index.js";

const tracer = trace.getTracer("worldx-server");

let sdk: NodeSDK | undefined;
let processor: BatchSpanProcessor | undefined;
let initialization: Promise<boolean> | undefined;

type LLMSpanContext = {
  model: string;
  taskType: string;
};

async function initializeAgentPond(): Promise<boolean> {
  if (process.env.AGENTPOND_ENABLED !== "true") {
    return false;
  }

  initialization ??= Promise.resolve().then(() => {
    try {
      processor = new BatchSpanProcessor(
        createFilesSpanExporterFromRuntimeEnv(),
      );
      sdk = new NodeSDK({
        serviceName: "worldx-server",
        spanProcessors: [processor],
      });
      sdk.start();
      process.once("beforeExit", () => {
        void shutdownAgentPond();
      });
      return true;
    } catch (error) {
      console.warn(
        "[AgentPond] Tracing could not be initialized; continuing without it.",
        error,
      );
      processor = undefined;
      sdk = undefined;
      return false;
    }
  });

  return initialization;
}

export async function withAgentPondLLMSpan<T>(
  context: LLMSpanContext,
  operation: () => Promise<LLMCallResult<T>>,
): Promise<LLMCallResult<T>> {
  if (!(await initializeAgentPond())) {
    return operation();
  }

  const attributes: Attributes = {
    "openinference.span.kind": "LLM",
    "llm.model_name": context.model,
    "worldx.llm.task_type": context.taskType,
  };

  return tracer.startActiveSpan(
    "worldx.llm.call",
    { attributes },
    async (span) => {
      try {
        const result = await operation();
        span.setAttributes({
          "llm.token_count.prompt": result.usage.promptTokens,
          "llm.token_count.completion": result.usage.completionTokens,
          "llm.token_count.total": result.usage.totalTokens,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        const exception =
          error instanceof Error ? error : new Error(String(error));
        span.recordException(exception);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: exception.message,
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export async function flushAgentPond(): Promise<void> {
  await processor?.forceFlush();
}

export async function shutdownAgentPond(): Promise<void> {
  const activeSdk = sdk;
  sdk = undefined;
  processor = undefined;
  if (activeSdk) {
    await activeSdk.shutdown();
  }
}
