-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "rateMinorPerUnit" BIGINT,
ADD COLUMN     "sourceAmountMinor" BIGINT,
ADD COLUMN     "sourceCurrency" TEXT NOT NULL DEFAULT 'NGN';

-- CreateTable
CREATE TABLE "DepositAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'klasha',
    "providerRef" TEXT,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositAccount_userId_key" ON "DepositAccount"("userId");

-- CreateIndex
CREATE INDEX "DepositAccount_accountNumber_idx" ON "DepositAccount"("accountNumber");

-- AddForeignKey
ALTER TABLE "DepositAccount" ADD CONSTRAINT "DepositAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
