import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  ThinkingLevel,
  type GenerateContentResponse,
} from "@google/genai";
import { z } from "zod";
import { env, json } from "../config.js";
import { Decision } from "../schema.js";
import { toolInputs } from "../tools.js";
import { freeProjectGuard, modelCatalog, modelEnabled } from "./catalog.js";
import { modelRequest, type AgentContext } from "../provider.js";
export interface Usage {
  input: number;
  output: number;
  total: number;
}
export interface Generation {
  calls: { name: string; args: Record<string, unknown> }[];
  text?: string;
  usage?: Usage;
  finishReason?: string;
}
export class GeminiFailure extends Error {
  constructor(
    public status: number,
    public retryAt: Date | undefined,
    public shared: boolean,
    public daily: boolean,
  ) {
    super(
      `Gemini API HTTP ${status}${status === 429 && shared ? " (shared or unclassified quota)" : status >= 500 ? " (temporary provider failure)" : ""}`,
    );
  }
}
export function parseFailure(
  status: number,
  headers: Headers,
  body: unknown,
  now = new Date(),
) {
  const data = z
    .object({
      error: z
        .object({
          details: z.array(z.record(z.string(), z.unknown())).optional(),
        })
        .optional(),
    })
    .safeParse(body).data;
  const details = data?.error?.details ?? [];
  let daily = false,
    scoped = false,
    unknown = false,
    delay = 0;
  for (const item of details) {
    if (String(item["@type"]).endsWith("RetryInfo")) {
      const seconds = Number(String(item.retryDelay ?? "").replace(/s$/, ""));
      if (Number.isFinite(seconds)) delay = Math.max(delay, seconds * 1000);
    }
    if (
      String(item["@type"]).endsWith("QuotaFailure") &&
      Array.isArray(item.violations)
    )
      for (const raw of item.violations) {
        const v = z.record(z.string(), z.unknown()).safeParse(raw).data ?? {};
        daily ||= /perday|per_day|daily/i.test(`${v.quotaId} ${v.quotaMetric}`);
        const dims = z
          .record(z.string(), z.unknown())
          .safeParse(v.quotaDimensions).data;
        scoped ||= Boolean(dims?.model);
        unknown ||= !dims?.model;
      }
  }
  const retry = headers.get("retry-after");
  if (retry) {
    const seconds = Number(retry);
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retry) - now.getTime();
    if (Number.isFinite(ms)) delay = Math.max(delay, ms);
  }
  return new GeminiFailure(
    status,
    delay > 0 ? new Date(now.getTime() + delay) : undefined,
    status === 429 && (unknown || !scoped),
    daily,
  );
}
// Gemini receives a JSON string for arbitrary tool inputs; Zod restores the existing action contract.
// No JSON MIME/tool-call combination or Gemma structured-output equivalence is assumed.
export const GeminiDecision = z
  .object({
    ...Decision.shape,
    projectId: Decision.shape.projectId.describe(
      "Exact existing project ID, or null ONLY when creating a newProject. Never select both or neither.",
    ),
    newProject: Decision.shape.newProject.describe(
      "Must be null when projectId is set. Otherwise provide the complete new project object.",
    ),
    input: z
      .union(Object.values(toolInputs))
      .describe("Native JSON input object matching the selected tool's schema"),
  })
  .strict();
export function parseGeminiDecision(value: unknown) {
  const legacy = z.record(z.string(), z.unknown()).parse(value);
  const args = GeminiDecision.parse({
    ...legacy,
    input:
      typeof legacy.input === "string"
        ? JSON.parse(legacy.input)
        : legacy.input,
  });
  const decision = Decision.parse(args);
  toolInputs[decision.tool].parse(decision.input);
  return decision;
}
/** Diagnostics contain schema paths/codes, never raw model output or private reasoning. */
export function decisionFailureReason(error: unknown, response?: Generation) {
  if (response?.finishReason === "MAX_TOKENS")
    return "Output token limit reached before a complete structured action";
  if (error instanceof z.ZodError)
    return `Action validation: ${error.issues
      .slice(0, 5)
      .map(
        (issue) =>
          `${issue.path.join(".") || "project choice"}: ${issue.code}${issue.code === "custom" ? " (select exactly one existing project or new project)" : ""}`,
      )
      .join("; ")}`.slice(0, 1200);
  if (error instanceof SyntaxError)
    return "Action validation: input must be a valid JSON object encoded as a string";
  return "Action validation: expected exactly one complete choose_action function call";
}
export function geminiPayload(context: AgentContext) {
  const request = modelRequest(context);
  return {
    system:
      request.messages[0].content +
      '\nGemini wire protocol: call choose_action exactly once. Set projectId to an exact ID from context.projects and newProject to null; OR set projectId to null and supply a complete newProject. Never set both or neither. The input field is a native JSON object matching the selected tool schema, not an encoded string. For example, research.search input is {"query":"seller pricing problems"}. Do not include Markdown fences. All other fields must satisfy the function schema.',
    contents: request.messages[1].content,
    schema: z.toJSONSchema(GeminiDecision, { io: "input" }),
  };
}
export interface GeminiTransport {
  metadata(modelId: string): Promise<{ actions: string[] }>;
  generate(
    modelId: string,
    payload: ReturnType<typeof geminiPayload>,
    maxOutput: number,
    options?: { probe?: boolean; routineFallback?: boolean },
  ): Promise<Generation>;
  text(modelId: string, prompt: string, maxOutput: number): Promise<Generation>;
}
function usageOf(response: GenerateContentResponse): Usage | undefined {
  const usage = response.usageMetadata;
  if (
    !usage ||
    usage.promptTokenCount === undefined ||
    usage.totalTokenCount === undefined
  )
    return undefined;
  return {
    input: usage.promptTokenCount,
    output: usage.totalTokenCount - usage.promptTokenCount,
    total: usage.totalTokenCount,
  };
}
function client() {
  // SDK retries are disabled: every inference attempt must first reserve durable quota.
  return new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    vertexai: false,
    httpOptions: {
      apiVersion: "v1beta",
      timeout: 30000,
      retryOptions: { attempts: 1 },
      fetch: async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (
          url.protocol !== "https:" ||
          url.hostname !== "generativelanguage.googleapis.com"
        )
          throw new Error("Unapproved Gemini endpoint");
        const response = await fetch(input, init);
        if (!response.ok) {
          let body: unknown;
          try {
            const text = await response.clone().text();
            if (text.length < 100000) body = JSON.parse(text);
          } catch {
            /* status/header diagnostics remain available */
          }
          throw parseFailure(response.status, response.headers, body);
        }
        return response;
      },
    },
  });
}
export class GoogleGeminiTransport implements GeminiTransport {
  async metadata(modelId: string) {
    const model = await client().models.get({ model: modelId });
    return { actions: model.supportedActions ?? [] };
  }
  async generate(
    modelId: string,
    payload: ReturnType<typeof geminiPayload>,
    maxOutput: number,
    options?: { probe?: boolean; routineFallback?: boolean },
  ) {
    freeProjectGuard();
    const reviewed = modelCatalog.find((model) => model.id === modelId);
    if (
      !modelEnabled(modelId) ||
      !reviewed?.freeStandard ||
      !reviewed.capabilities.includes("structured") ||
      (reviewed.expiresAt && new Date(reviewed.expiresAt) <= new Date())
    )
      throw new Error("Unreviewed inference model is blocked");
    const response = await client().models.generateContent({
      model: modelId,
      contents: payload.contents,
      config: {
        systemInstruction: payload.system,
        maxOutputTokens: maxOutput,
        ...((options?.probe || options?.routineFallback) &&
        reviewed.probeThinking
          ? {
              thinkingConfig: {
                thinkingLevel:
                  reviewed.probeThinking === "minimal"
                    ? ThinkingLevel.MINIMAL
                    : ThinkingLevel.LOW,
              },
            }
          : {}),
        tools: [
          {
            functionDeclarations: [
              {
                name: "choose_action",
                description:
                  "Choose one action for independent supervisor validation. Tool input is JSON encoded.",
                parametersJsonSchema: payload.schema,
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: ["choose_action"],
          },
        },
        abortSignal: AbortSignal.timeout(35000),
      },
    });
    return {
      calls: (response.functionCalls ?? []).map((c) => ({
        name: c.name ?? "",
        args: c.args ?? {},
      })),
      usage: usageOf(response),
      finishReason: response.candidates?.[0]?.finishReason,
    };
  }
  async text(modelId: string, prompt: string, maxOutput: number) {
    freeProjectGuard();
    if (!modelEnabled(modelId))
      throw new Error("Model disabled by the operator's active model policy");
    if (
      !modelCatalog.some(
        (model) =>
          model.id === modelId &&
          (model.experimental || model.id === "gemini-3.5-flash-lite") &&
          model.freeStandard &&
          model.capabilities.includes("text"),
      )
    )
      throw new Error(
        "Only reviewed experimental plain-text models are enabled here",
      );
    const response = await client().models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        maxOutputTokens: maxOutput,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: AbortSignal.timeout(35000),
      },
    });
    return { calls: [], text: response.text, usage: usageOf(response) };
  }
}
export const estimatedInput = (payload: unknown) =>
  Buffer.byteLength(json(payload));
