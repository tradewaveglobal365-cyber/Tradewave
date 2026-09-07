-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('NIN', 'PASSPORT', 'EMIRATES_ID');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- CreateTable
CREATE TABLE "KycVerification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "documentType" "DocumentType" NOT NULL,
    "documentLast4" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "KycVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KycVerification_providerRef_key" ON "KycVerification"("providerRef");

-- CreateIndex
CREATE INDEX "KycVerification_userId_status_idx" ON "KycVerification"("userId", "status");

-- CreateIndex
CREATE INDEX "KycVerification_documentHash_idx" ON "KycVerification"("documentHash");

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
