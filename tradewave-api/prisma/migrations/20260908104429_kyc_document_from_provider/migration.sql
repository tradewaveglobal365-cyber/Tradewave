-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'NATIONAL_ID';
ALTER TYPE "DocumentType" ADD VALUE 'DRIVERS_LICENSE';
ALTER TYPE "DocumentType" ADD VALUE 'VOTERS_CARD';
ALTER TYPE "DocumentType" ADD VALUE 'RESIDENCE_PERMIT';
ALTER TYPE "DocumentType" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "KycVerification" ALTER COLUMN "documentType" DROP NOT NULL,
ALTER COLUMN "documentLast4" DROP NOT NULL,
ALTER COLUMN "documentHash" DROP NOT NULL;
