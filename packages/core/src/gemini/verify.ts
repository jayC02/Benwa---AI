import { db } from "../db.js";
import { env } from "../config.js";
import { Decision } from "../schema.js";
import {
  freeProjectGuard,
  routingConfiguration,
  routingPolicy,
} from "./catalog.js";
import {
  reserveModelRequest,
  finishModelRequest,
  credentialFingerprint,
  setCooldown,
} from "./quota.js";
import {
  GoogleGeminiTransport,
  GeminiFailure,
  geminiPayload,
  estimatedInput,
  parseGeminiDecision,
  decisionFailureReason,
  type GeminiTransport,
  type Generation,
} from "./transport.js";
import { ProviderWaitError } from "../provider.js";
import { nextPacificReset, type RoutingTask } from "./policy.js";
export const probeTask: RoutingTask = {
  kind: "routine",
  tier: 1,
  important: false,
  required: ["tools", "structured"],
  reason: "Bounded access/capability probe; no execution tools run.",
};
export const probeRetryDelay = (failures: number) =>
  Math.min(
    routingPolicy.probeRetryMaximumMs,
    routingPolicy.probeRetryBaseMs *
      2 ** Math.min(5, Math.max(0, failures - 1)),
  );
const probeDecision = Decision.parse({
  projectId: "access-probe",
  newProject: null,
  goal: "Verify the action envelope without executing tools",
  category: "learn",
  target: "access-probe",
  intention: "Validate one structured decision without performing any action",
  rationale:
    "The operator requested an API capability check before enabling routing",
  strategy: "capability-probe",
  tool: "workspace.read",
  input: { path: "probe.txt" },
  expectedEvidence: "A schema-valid function call; no tool executes",
  costEstimateMinor: 0,
  permissions: ["local"],
  thought: "Checking that this model can speak the action protocol.",
});
export async function verifyModels(
  probe = false,
  ids?: string[],
  transport: GeminiTransport = new GoogleGeminiTransport(),
  experimentalProbe = false,
) {
  if (!env.GEMINI_API_KEY || !env.GEMINI_PROJECT_ID)
    throw new Error("Configure GEMINI_API_KEY and GEMINI_PROJECT_ID locally");
  if (probe) freeProjectGuard();
  const result: {
    id: string;
    status: string;
    detail: string;
    inferenceAttempted: boolean;
  }[] = [];
  for (const model of routingConfiguration().models.filter(
    (m) => !ids || ids.includes(m.id),
  )) {
    const where = {
      scope_modelId: { scope: env.GEMINI_PROJECT_ID, modelId: model.id },
    };
    let request: Awaited<ReturnType<typeof reserveModelRequest>> | undefined;
    let observedUsage: import("./transport.js").Usage | undefined;
    let observedOutput: Generation | undefined;
    try {
      const metadata = await transport.metadata(model.id);
      const previous = await db.modelAccess.findUnique({ where });
      const existingReady =
        previous?.status === "READY" &&
        previous.credentialFingerprint === credentialFingerprint();
      await db.modelAccess.upsert({
        where,
        create: {
          scope: env.GEMINI_PROJECT_ID,
          modelId: model.id,
          credentialFingerprint: credentialFingerprint(),
          capabilities: model.capabilities,
          metadataAt: new Date(),
        },
        update: {
          metadataAt: new Date(),
          ...(existingReady
            ? {}
            : {
                status: "UNVERIFIED",
                credentialFingerprint: credentialFingerprint(),
                capabilities: model.capabilities,
                verifiedAt: null,
              }),
        },
      });
      const generation = model.capabilities.includes("text");
      if (
        !probe ||
        !generation ||
        (model.experimental &&
          !env.GEMINI_EXPERIMENTAL_GEMMA &&
          !experimentalProbe)
      ) {
        result.push({
          id: model.id,
          status: existingReady ? "READY" : "METADATA_ONLY",
          inferenceAttempted: false,
          detail: generation
            ? "Metadata accessible; inference/capability probe not performed."
            : "Specialized endpoint evaluated; not part of the agent action contract.",
        });
        continue;
      }
      if (
        !metadata.actions.some((a) =>
          a.toLowerCase().includes("generatecontent"),
        )
      )
        throw new Error("Metadata does not advertise generateContent");
      const wire = {
        ...probeDecision,
        input: JSON.stringify(probeDecision.input),
      };
      const payload = geminiPayload({
        state: { name: "Benwa" },
        guidance: [
          `Capability probe: return exactly this choose_action call: ${JSON.stringify(wire)}. No execution tools will run.`,
        ],
        projects: [
          {
            id: "access-probe",
            name: "Capability check",
            stage: "RESEARCH",
            score: 0,
            hypothesis: {},
            tasks: [],
            goals: [],
          },
        ],
        memories: [],
        recent: [],
        restrictions: [],
        portfolio: "Capability probe only",
        approvedHosts: "none",
        financial: { revenue: 0 },
      });
      const plainPrompt = "Return exactly the two words: Benwa ready";
      request = await reserveModelRequest({
        modelId: model.id,
        task: probeTask,
        estimatedInput: model.experimental
          ? estimatedInput(plainPrompt)
          : estimatedInput(payload),
        maxOutput: Math.min(
          env.LLM_MAX_OUTPUT_TOKENS,
          model.experimental ? 128 : 1600,
        ),
        probe: true,
      });
      const output = model.experimental
        ? await transport.text(model.id, plainPrompt, 128)
        : await transport.generate(
            model.id,
            payload,
            Math.min(env.LLM_MAX_OUTPUT_TOKENS, 1600),
            { probe: true },
          );
      observedUsage = output.usage;
      observedOutput = output;
      if (model.experimental) {
        if (!output.text?.trim() || output.text.length > 4000)
          throw new Error("Plain text probe failed");
      } else {
        if (
          output.calls.length !== 1 ||
          output.calls[0].name !== "choose_action"
        )
          throw new Error(decisionFailureReason(undefined, output));
        parseGeminiDecision(output.calls[0].args);
      }
      await finishModelRequest(request.id, "SUCCEEDED", output.usage);
      if (!output.usage)
        throw new Error(
          "Probe response omitted token usage; not enabling model",
        );
      await db.modelAccess.update({
        where,
        data: { status: "READY", verifiedAt: new Date(), error: null },
      });
      result.push({
        id: model.id,
        status: "READY",
        inferenceAttempted: true,
        detail: model.experimental
          ? "Plain text probe passed; structured agent routing remains excluded."
          : "Actual structured action probe passed. No action tool executed.",
      });
    } catch (e) {
      if (request)
        await finishModelRequest(
          request.id,
          e instanceof GeminiFailure && e.status === 429
            ? "RATE_LIMITED"
            : observedUsage
              ? "INVALID"
              : "FAILED",
          observedUsage,
          e instanceof GeminiFailure
            ? e.message
            : decisionFailureReason(e, observedOutput),
        );
      const prior = await db.modelAccess.findUnique({ where });
      const keepVerified =
        prior?.status === "READY" &&
        prior.credentialFingerprint === credentialFingerprint();
      const recentProbes = await db.modelRequest.findMany({
        where: {
          scope: env.GEMINI_PROJECT_ID,
          modelId: model.id,
          operation: "probe",
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const successIndex = recentProbes.findIndex(
        (row) => row.status === "SUCCEEDED",
      );
      const failures = successIndex < 0 ? recentProbes.length : successIndex;
      const wait =
        e instanceof ProviderWaitError
          ? e.retryAt
          : e instanceof GeminiFailure && (e.status === 429 || e.status >= 500)
            ? e.daily
              ? new Date(
                  Math.max(
                    nextPacificReset().getTime(),
                    e.retryAt?.getTime() ?? 0,
                  ),
                )
              : new Date(
                  Math.max(
                    e.retryAt?.getTime() ?? 0,
                    Date.now() + probeRetryDelay(failures),
                  ),
                )
            : observedUsage
              ? new Date(Date.now() + probeRetryDelay(failures))
              : undefined;
      if (wait) {
        await setCooldown(
          e instanceof GeminiFailure && e.status === 429 && e.shared
            ? "generation-project"
            : model.id,
          wait,
          observedUsage
            ? decisionFailureReason(e, observedOutput)
            : "Capability probe deferred after quota or temporary provider failure",
        );
        await db.modelAccess.upsert({
          where,
          create: {
            scope: env.GEMINI_PROJECT_ID,
            modelId: model.id,
            credentialFingerprint: credentialFingerprint(),
            capabilities: model.capabilities,
            metadataAt: new Date(),
            error:
              e instanceof GeminiFailure
                ? e.message
                : decisionFailureReason(e, observedOutput),
          },
          update: {
            status: keepVerified ? "READY" : "UNVERIFIED",
            metadataAt: new Date(),
            error:
              e instanceof GeminiFailure
                ? e.message
                : e instanceof ProviderWaitError
                  ? "Probe deferred"
                  : decisionFailureReason(e, observedOutput),
          },
        });
        result.push({
          id: model.id,
          status: "COOLDOWN",
          inferenceAttempted: Boolean(request),
          detail: `Probe deferred until ${wait.toISOString()}`,
        });
        continue;
      }
      const detail =
        e instanceof GeminiFailure
          ? e.message
          : e instanceof Error
            ? e.message
            : "Probe failed";
      await db.modelAccess.upsert({
        where,
        create: {
          scope: env.GEMINI_PROJECT_ID,
          modelId: model.id,
          credentialFingerprint: credentialFingerprint(),
          status: "UNAVAILABLE",
          capabilities: model.capabilities,
          error: detail,
        },
        update: { status: "UNAVAILABLE", error: detail },
      });
      result.push({
        id: model.id,
        status: "UNAVAILABLE",
        detail,
        inferenceAttempted: Boolean(request),
      });
    }
  }
  return result;
}

/** Refresh one previously checked transient/stale model, with durable backoff and a hard retry cap. */
export async function refreshTemporaryModelAccess(
  transport: GeminiTransport,
  maximumTier: number,
) {
  const scope = env.GEMINI_PROJECT_ID,
    now = new Date();
  const access = await db.modelAccess.findMany({
    where: { scope, credentialFingerprint: credentialFingerprint() },
  });
  const cooldowns = await db.modelCooldown.findMany({
    where: { scope, until: { gt: now } },
  });
  for (const model of routingConfiguration().models) {
    if (
      !model.freeStandard ||
      model.experimental ||
      !model.capabilities.includes("structured") ||
      model.tier > maximumTier ||
      (model.expiresAt && new Date(model.expiresAt) <= now)
    )
      continue;
    const record = access.find((row) => row.modelId === model.id);
    if (!record) continue; // New or denied models require the explicit setup probe.
    const stale =
      record.status === "READY" &&
      (!record.verifiedAt ||
        now.getTime() - record.verifiedAt.getTime() > 7 * 86400000);
    const temporary =
      record.status === "UNVERIFIED" &&
      /HTTP 5\d\d|temporary provider|Action validation|Output token limit|Probe deferred/i.test(
        record.error ?? "",
      );
    if (!stale && !temporary) continue;
    if (cooldowns.some((row) => [model.id, ...model.groups].includes(row.key)))
      continue;
    const probes = await db.modelRequest.findMany({
      where: { scope, modelId: model.id, operation: "probe" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const successIndex = probes.findIndex((row) => row.status === "SUCCEEDED");
    const failures = successIndex < 0 ? probes.length : successIndex;
    if (failures >= routingPolicy.maximumAutomaticProbeFailures) continue;
    const checkedAt = Math.max(
      record.metadataAt?.getTime() ?? 0,
      probes[0]?.createdAt.getTime() ?? 0,
    );
    if (now.getTime() - checkedAt < probeRetryDelay(failures)) continue;
    const [result] = await verifyModels(true, [model.id], transport);
    return result?.inferenceAttempted ?? false;
  }
  return false;
}
