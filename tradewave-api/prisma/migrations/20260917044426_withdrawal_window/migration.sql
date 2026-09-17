-- CreateTable
CREATE TABLE "WithdrawalWindow" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[5]::INTEGER[],
    "opensAtMinute" INTEGER NOT NULL DEFAULT 540,
    "closesAtMinute" INTEGER NOT NULL DEFAULT 1020,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" UUID,

    CONSTRAINT "WithdrawalWindow_pkey" PRIMARY KEY ("id")
);
