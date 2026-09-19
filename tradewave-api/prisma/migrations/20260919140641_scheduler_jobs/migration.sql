-- AlterTable
ALTER TABLE "Investment" ADD COLUMN     "maturityNoticeSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "KycVerification" ADD COLUMN     "abandonedNoticeSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastStatementPeriod" TEXT;

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("name")
);
