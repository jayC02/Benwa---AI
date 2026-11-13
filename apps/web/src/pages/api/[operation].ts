import type { APIRoute } from "astro";
import { z } from "zod";
import {
  db,
  env,
  json,
  errorText,
  startCreature,
  Settings,
  recordTransaction,
  verifyStripeSignature,
  readArtifact,
  freeProjectGuard,
} from "@benwa/core";
import { snapshot } from "../../server/snapshot";
import { authenticatePassword, issueSession } from "../../server/auth";
const response = (data: unknown, status = 200) =>
  new Response(json(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
export const GET: APIRoute = async ({ params, url }) => {
  try {
    if (params.operation === "state") return response(await snapshot());
    if (params.operation === "artifact") {
      const projectId = z
        .string()
        .regex(/^[a-z0-9_-]{1,100}$/i)
        .parse(url.searchParams.get("project"));
      const file = z
        .string()
        .min(1)
        .max(240)
        .parse(url.searchParams.get("path"));
      if (!(await db.project.findUnique({ where: { id: projectId } })))
        throw new Error("Project not found");
      const content = await readArtifact(projectId, file);
      // Serve untrusted code as plain text under a sandbox CSP, never execute in the dashboard origin.
      return new Response(content, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Content-Disposition": `inline; filename="artifact.txt"`,
        },
      });
    }
    return response({ error: "Not found" }, 404);
  } catch (e) {
    return response({ error: errorText(e) }, 400);
  }
};
export const POST: APIRoute = async ({
  params,
  request,
  cookies,
  clientAddress,
}) => {
  try {
    if (params.operation === "stripe") {
      if (!env.STRIPE_WEBHOOK_SECRET)
        return response({ error: "Stripe integration is not configured" }, 503);
      const body = await request.text();
      if (body.length > 150000) throw new Error("Webhook too large");
      verifyStripeSignature(
        body,
        request.headers.get("stripe-signature") ?? "",
        env.STRIPE_WEBHOOK_SECRET,
      );
      const event = z
        .object({
          id: z.string().max(200),
          type: z.string(),
          livemode: z.boolean(),
          data: z.object({ object: z.unknown() }),
        })
        .parse(JSON.parse(body));
      if (!event.livemode || event.type !== "payment_intent.succeeded")
        return response({ received: true, ignored: true });
      const payment = z
        .object({
          id: z.string(),
          currency: z.literal("gbp"),
          amount_received: z.number().int().positive(),
          status: z.literal("succeeded"),
        })
        .parse(event.data.object);
      // Signed receipt is authentic, but settlement, fees and refunds still need reconciliation.
      // Do not reward or count a gross receipt as realised profit.
      await db.memory.upsert({
        where: { id: `stripe_${event.id}` },
        update: {},
        create: {
          id: `stripe_${event.id}`,
          category: "financial",
          content: `Stripe live receipt ${payment.id}: ${payment.amount_received} GBP minor units. Pending settlement and fee reconciliation; excluded from the ledger. Event ${event.id}.`,
          verified: true,
          importance: 1,
        },
      });
      return response({ received: true, pendingReconciliation: true });
    }
    const text = await request.text();
    if (text.length > 150000) throw new Error("Request too large");
    const body: unknown = JSON.parse(text);
    if (params.operation === "login") {
      const { password } = z
        .object({ password: z.string().max(200) })
        .parse(body);
      if (
        !env.DASHBOARD_PASSWORD ||
        !authenticatePassword(password, clientAddress)
      )
        return response({ error: "Invalid password" }, 401);
      cookies.set("benwa_session", issueSession(), {
        httpOnly: true,
        sameSite: "strict",
        secure: new URL(request.url).protocol === "https:",
        path: "/",
        maxAge: 86400,
      });
      return response({ ok: true });
    }
    if (params.operation === "control") {
      const { command } = z
        .object({ command: z.enum(["start", "pause", "resume", "stop"]) })
        .strict()
        .parse(body);
      const cfg = await db.agentConfiguration.findUniqueOrThrow({
        where: { id: "main" },
      });
      if (["start", "resume"].includes(command)) {
        if (cfg.mode === "real" && env.LLM_PROVIDER === "gemini")
          freeProjectGuard();
        if (
          cfg.mode === "real" &&
          env.LLM_PROVIDER !== "gemini" &&
          !env.LLM_API_KEY
        )
          throw new Error("Configure LLM_API_KEY before starting real mode");
        const started = await startCreature();
        return response({
          ok: true,
          notice: started.pendingReviews
            ? "Benwa is continuing other local work. Your pending requests still need review."
            : "Benwa started.",
        });
      } else
        await db.creatureState.update({
          where: { id: "benwa" },
          data: {
            status: command === "stop" ? "STOPPED" : "PAUSED",
            activity: command === "stop" ? "Emergency stop" : "Paused",
          },
        });
      return response({ ok: true });
    }
    if (params.operation === "settings") {
      const settings = Settings.parse(body);
      await db.$transaction(async (tx) => {
        const { authorisedMinor, ...config } = settings;
        await tx.agentConfiguration.update({
          where: { id: "main" },
          data: config,
        });
        await tx.budget.upsert({
          where: { day: new Date().toISOString().slice(0, 10) },
          update: { authorisedMinor: BigInt(authorisedMinor) },
          create: {
            day: new Date().toISOString().slice(0, 10),
            authorisedMinor: BigInt(authorisedMinor),
          },
        });
      });
      return response({ ok: true });
    }
    if (params.operation === "approval") {
      const { id, decision } = z
        .object({ id: z.string(), decision: z.enum(["APPROVED", "REJECTED"]) })
        .strict()
        .parse(body);
      await db.$transaction(async (tx) => {
        const approval = await tx.approvalRequest.findUniqueOrThrow({
          where: { id },
          include: { action: { select: { projectId: true } } },
        });
        if (
          approval.status !== "PENDING" ||
          (decision === "APPROVED" && approval.expiresAt < new Date())
        )
          throw new Error("Approval is no longer pending or has expired");
        await tx.approvalRequest.update({
          where: { id },
          data: { status: decision, reviewedAt: new Date() },
        });
        await tx.action.update({
          where: { id: approval.actionId },
          data: {
            status:
              decision === "APPROVED" ? "APPROVED_PREPARATION" : "REJECTED",
            completedAt: new Date(),
          },
        });
        await tx.memory.create({
          data: {
            category: "episodic",
            content: `Human ${decision.toLowerCase()} preparation ${approval.actionId}. No external executor ran.`,
            verified: true,
            importance: 0.8,
          },
        });
        if (
          !(await tx.approvalRequest.count({
            where: {
              status: "PENDING",
              action: { projectId: approval.action.projectId },
            },
          }))
        )
          await tx.project.updateMany({
            where: {
              id: approval.action.projectId,
              status: "AWAITING_APPROVAL",
            },
            data: { status: "ACTIVE" },
          });
        await tx.creatureState.updateMany({
          where: { id: "benwa", status: "WAITING_APPROVAL" },
          data: {
            status: "PAUSED",
            activity: "Review recorded; external execution remains disabled",
            thought:
              "Your decision is saved. Nothing has been published or purchased.",
          },
        });
      });
      return response({
        ok: true,
        notice:
          "Consent recorded. No external executor is connected; nothing was published, sent or purchased.",
      });
    }
    if (params.operation === "assistance") {
      const { id, reply } = z
        .object({ id: z.string(), reply: z.string().min(10).max(12000) })
        .strict()
        .parse(body);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
        const item = await tx.humanAssistanceRequest.findUniqueOrThrow({
          where: { id },
        });
        if (item.status !== "OPEN")
          throw new Error("This help request has already been resolved");
        const cfg = await tx.agentConfiguration.findUniqueOrThrow({
          where: { id: "main" },
        });
        if (
          (await tx.project.count({ where: { status: "ACTIVE" } })) >=
          cfg.maxProjects
        )
          throw new Error(
            "Suspend an active project before reactivating this one",
          );
        await tx.humanAssistanceRequest.update({
          where: { id },
          data: { status: "RESOLVED", response: reply, resolvedAt: new Date() },
        });
        await tx.memory.create({
          data: {
            category: "project",
            projectId: item.projectId,
            content: `Human guidance (review against evidence; does not grant spending or publication rights): ${reply}`,
            verified: false,
            importance: 1,
          },
        });
        await tx.project.update({
          where: { id: item.projectId },
          data: { status: "ACTIVE", stagnantAttempts: 0 },
        });
        await tx.supervisorIntervention.updateMany({
          where: { projectId: item.projectId, resolvedAt: null },
          data: { resolvedAt: new Date() },
        });
        await tx.creatureState.updateMany({
          where: { id: "benwa", status: "WAITING_ASSISTANCE" },
          data: {
            status: "PAUSED",
            activity: "Human guidance saved; ready to resume",
          },
        });
      });
      return response({
        ok: true,
        notice:
          "Guidance saved and project reactivated. No personal AI account was connected.",
      });
    }
    if (params.operation === "finance")
      return response(await recordTransaction(body, "authenticated-human"));
    if (params.operation === "project") {
      const { id, command, reason } = z
        .object({
          id: z.string(),
          command: z.enum(["suspend", "reactivate"]),
          reason: z.string().min(20).max(1000),
        })
        .strict()
        .parse(body);
      if (command === "reactivate") {
        const cfg = await db.agentConfiguration.findUniqueOrThrow({
          where: { id: "main" },
        });
        if (
          (await db.project.count({ where: { status: "ACTIVE" } })) >=
          cfg.maxProjects
        )
          throw new Error("Active project limit reached");
      }
      await db.$transaction([
        db.project.update({
          where: { id },
          data: {
            status: command === "suspend" ? "SUSPENDED" : "ACTIVE",
            stagnantAttempts: 0,
          },
        }),
        db.memory.create({
          data: {
            category: "project",
            projectId: id,
            content: `Human ${command}: ${reason}`,
            verified: true,
            importance: 1,
          },
        }),
        db.supervisorIntervention.updateMany({
          where: { projectId: id, resolvedAt: null },
          data: { resolvedAt: new Date() },
        }),
      ]);
      return response({ ok: true });
    }
    return response({ error: "Not found" }, 404);
  } catch (e) {
    return response({ error: errorText(e) }, 400);
  }
};
