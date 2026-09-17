-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('SUSPEND', 'REINSTATE', 'RESTRICT', 'UNRESTRICT', 'BLOCK_WITHDRAWALS', 'UNBLOCK_WITHDRAWALS', 'FORCE_KYC_REVERIFICATION', 'ADJUST_BALANCE', 'VERIFY_EMAIL', 'PAUSE_WITHDRAWALS', 'RESUME_WITHDRAWALS');

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'RESTRICTED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kycResetAt" TIMESTAMP(3),
ADD COLUMN     "withdrawalsBlockedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WithdrawalWindow" ADD COLUMN     "paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pausedReason" TEXT;

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" UUID NOT NULL,
    "type" "AdminActionType" NOT NULL,
    "actorId" UUID NOT NULL,
    "subjectId" UUID,
    "reason" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAction_subjectId_createdAt_idx" ON "AdminAction"("subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAction_actorId_createdAt_idx" ON "AdminAction"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
