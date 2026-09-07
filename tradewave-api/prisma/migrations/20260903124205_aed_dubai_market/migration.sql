/*
  Warnings:

  - You are about to drop the column `amountKobo` on the `Deposit` table. All the data in the column will be lost.
  - You are about to drop the column `koboPerUnit` on the `FxRate` table. All the data in the column will be lost.
  - You are about to drop the column `principalKobo` on the `Investment` table. All the data in the column will be lost.
  - You are about to drop the column `amountKobo` on the `LedgerEntry` table. All the data in the column will be lost.
  - You are about to drop the column `balanceAfterKobo` on the `LedgerEntry` table. All the data in the column will be lost.
  - You are about to drop the column `fundedKobo` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `minInvestmentKobo` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `totalValueKobo` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `balanceKobo` on the `Wallet` table. All the data in the column will be lost.
  - Added the required column `amountFils` to the `Deposit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `filsPerUnit` to the `FxRate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `principalFils` to the `Investment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountFils` to the `LedgerEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `balanceAfterFils` to the `LedgerEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `area` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minInvestmentFils` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalValueFils` to the `Property` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Deposit" DROP COLUMN "amountKobo",
ADD COLUMN     "amountFils" BIGINT NOT NULL;

-- AlterTable
ALTER TABLE "FxRate" DROP COLUMN "koboPerUnit",
ADD COLUMN     "filsPerUnit" BIGINT NOT NULL,
ALTER COLUMN "baseCurrency" SET DEFAULT 'AED';

-- AlterTable
ALTER TABLE "Investment" DROP COLUMN "principalKobo",
ADD COLUMN     "principalFils" BIGINT NOT NULL;

-- AlterTable
ALTER TABLE "LedgerEntry" DROP COLUMN "amountKobo",
DROP COLUMN "balanceAfterKobo",
ADD COLUMN     "amountFils" BIGINT NOT NULL,
ADD COLUMN     "balanceAfterFils" BIGINT NOT NULL;

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "fundedKobo",
DROP COLUMN "minInvestmentKobo",
DROP COLUMN "state",
DROP COLUMN "totalValueKobo",
ADD COLUMN     "area" TEXT NOT NULL,
ADD COLUMN     "fundedFils" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "minInvestmentFils" BIGINT NOT NULL,
ADD COLUMN     "totalValueFils" BIGINT NOT NULL,
ALTER COLUMN "country" SET DEFAULT 'AE';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "country" SET DEFAULT 'AE';

-- AlterTable
ALTER TABLE "Wallet" DROP COLUMN "balanceKobo",
ADD COLUMN     "balanceFils" BIGINT NOT NULL DEFAULT 0;
