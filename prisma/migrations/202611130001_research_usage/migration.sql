CREATE TABLE "ResearchUsage" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "period" TEXT NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0, "tokens" INTEGER NOT NULL DEFAULT 0,
  "credits" INTEGER NOT NULL DEFAULT 0, "cooldownUntil" TIMESTAMP(3),
  "lastRequestAt" TIMESTAMP(3), "error" TEXT,
  CONSTRAINT "ResearchUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchUsage_provider_period_key" ON "ResearchUsage"("provider", "period");
ALTER TABLE "ResearchUsage" ENABLE ROW LEVEL SECURITY;
