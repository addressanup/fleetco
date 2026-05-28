-- CreateEnum
CREATE TYPE "expense_category" AS ENUM ('MAINTENANCE', 'REPAIR', 'TOLL', 'PARKING', 'INSURANCE', 'PERMIT', 'FINE', 'OTHER');

-- CreateTable
CREATE TABLE "expense_log" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT,
    "tripId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "category" "expense_category" NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "vendor" TEXT,
    "receiptNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "expense_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_log_vehicleId_idx" ON "expense_log"("vehicleId");

-- CreateIndex
CREATE INDEX "expense_log_tripId_idx" ON "expense_log"("tripId");

-- CreateIndex
CREATE INDEX "expense_log_category_idx" ON "expense_log"("category");

-- CreateIndex
CREATE INDEX "expense_log_date_idx" ON "expense_log"("date" DESC);

-- CreateIndex
CREATE INDEX "expense_log_createdById_idx" ON "expense_log"("createdById");

-- AddForeignKey
ALTER TABLE "expense_log" ADD CONSTRAINT "expense_log_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_log" ADD CONSTRAINT "expense_log_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_log" ADD CONSTRAINT "expense_log_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
