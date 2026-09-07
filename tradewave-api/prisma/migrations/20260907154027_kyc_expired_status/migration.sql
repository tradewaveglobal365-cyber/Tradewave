-- AlterEnum
ALTER TYPE "KycStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kycVerifiedAt" TIMESTAMP(3);
