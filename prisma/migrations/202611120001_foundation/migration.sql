-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "CreatureState" (
    "id" TEXT NOT NULL DEFAULT 'benwa',
    "name" TEXT NOT NULL DEFAULT 'Benwa',
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "activity" TEXT NOT NULL DEFAULT 'Waiting to begin',
    "thought" TEXT NOT NULL DEFAULT 'A small idea could become something useful.',
    "mood" DOUBLE PRECISION NOT NULL DEFAULT 62,
    "energy" DOUBLE PRECISION NOT NULL DEFAULT 85,
    "curiosity" DOUBLE PRECISION NOT NULL DEFAULT 78,
    "boredom" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "frustration" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "heartbeat" TIMESTAMP(3),
    "restUntil" TIMESTAMP(3),
    "restStartedAt" TIMESTAMP(3),
    "activeCycles" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatureState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmotionSnapshot" (
    "id" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "event" TEXT NOT NULL,
    "actionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmotionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfiguration" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "mode" TEXT NOT NULL DEFAULT 'demo',
    "cycleSeconds" INTEGER NOT NULL DEFAULT 25,
    "maxSteps" INTEGER NOT NULL DEFAULT 40,
    "restSeconds" INTEGER NOT NULL DEFAULT 120,
    "dailyTokenLimit" INTEGER NOT NULL DEFAULT 80000,
    "maxProjects" INTEGER NOT NULL DEFAULT 3,
    "rewardWeights" JSONB NOT NULL DEFAULT '{"discovery":2,"milestone":3,"repetition":-10,"stagnation":-20,"firstSale":15}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "tokensReserved" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "authorisedMinor" BIGINT NOT NULL DEFAULT 0,
    "spentMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'DISCOVERY',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hypothesis" JSONB NOT NULL,
    "verifiedMilestones" INTEGER NOT NULL DEFAULT 0,
    "stagnantAttempts" INTEGER NOT NULL DEFAULT 0,
    "progressAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "evidenceActionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dependsOnId" TEXT,
    "stage" TEXT NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCycle" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'DECIDING',
    "provider" TEXT NOT NULL,
    "decision" JSONB,
    "error" TEXT,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "reservation" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "intention" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "expectedEvidence" TEXT NOT NULL,
    "costEstimateMinor" BIGINT NOT NULL DEFAULT 0,
    "permissions" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionOutcome" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "meaningful" BOOLEAN NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "evidenceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "projectId" TEXT,
    "content" TEXT NOT NULL,
    "sourceActionId" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assessment" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "successCriterion" TEXT NOT NULL,
    "result" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorIntervention" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "actionId" TEXT,
    "level" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "blockedFingerprint" TEXT,
    "blockedStrategy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisorIntervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmotionSnapshot_actionId_key" ON "EmotionSnapshot"("actionId");

-- CreateIndex
CREATE INDEX "EmotionSnapshot_createdAt_idx" ON "EmotionSnapshot"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_day_key" ON "Budget"("day");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestone_evidenceActionId_key" ON "ProjectMilestone"("evidenceActionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestone_projectId_stage_key" ON "ProjectMilestone"("projectId", "stage");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCycle_jobId_key" ON "AgentCycle"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Action_cycleId_key" ON "Action"("cycleId");

-- CreateIndex
CREATE INDEX "Action_projectId_createdAt_idx" ON "Action"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Action_fingerprint_idx" ON "Action"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ActionOutcome_actionId_key" ON "ActionOutcome"("actionId");

-- CreateIndex
CREATE INDEX "ActionOutcome_evidenceHash_idx" ON "ActionOutcome"("evidenceHash");

-- CreateIndex
CREATE INDEX "Memory_projectId_category_createdAt_idx" ON "Memory"("projectId", "category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_externalId_key" ON "FinancialTransaction"("externalId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_currency_kind_idx" ON "FinancialTransaction"("currency", "kind");

-- CreateIndex
CREATE INDEX "SupervisorIntervention_projectId_resolvedAt_idx" ON "SupervisorIntervention"("projectId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_actionId_key" ON "ApprovalRequest"("actionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_key_key" ON "ScheduledJob"("key");

-- CreateIndex
CREATE INDEX "ScheduledJob_status_runAt_idx" ON "ScheduledJob"("status", "runAt");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_evidenceActionId_fkey" FOREIGN KEY ("evidenceActionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AgentCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionOutcome" ADD CONSTRAINT "ActionOutcome_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense in depth for Supabase Data API roles. Backend uses a private database role.
DO $$ DECLARE row_record RECORD; BEGIN
  FOR row_record IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',row_record.tablename);
  END LOOP;
END $$;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT positive_amount CHECK ("amountMinor">0);
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT ledger_currency CHECK (currency='GBP');
ALTER TABLE "CreatureState" ADD CONSTRAINT emotion_ranges CHECK (
  mood BETWEEN 0 AND 100 AND energy BETWEEN 0 AND 100 AND curiosity BETWEEN 0 AND 100
  AND boredom BETWEEN 0 AND 100 AND confidence BETWEEN 0 AND 100 AND frustration BETWEEN 0 AND 100);
ALTER TABLE "Budget" ADD CONSTRAINT nonnegative_budget CHECK ("tokensReserved">=0 AND "tokensUsed">=0 AND "authorisedMinor">=0 AND "spentMinor">=0);
-- Financial evidence is append-only, including for the application DB role.
CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial ledger is append-only; add a refund or correcting entry'; END $$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON "FinancialTransaction" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
