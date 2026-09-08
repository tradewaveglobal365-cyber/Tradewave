-- AlterTable
ALTER TABLE "KycVerification" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "faceMatchScore" DOUBLE PRECISION,
ADD COLUMN     "lastPolledAt" TIMESTAMP(3),
ADD COLUMN     "livenessScore" DOUBLE PRECISION,
ADD COLUMN     "pollCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "redirectUrl" TEXT;
