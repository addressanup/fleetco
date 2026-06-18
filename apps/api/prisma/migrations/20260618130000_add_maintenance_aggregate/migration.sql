-- Preventive-maintenance aggregate (ADR-0037): a ServiceSchedule (recurring
-- maintenance interval for a vehicle) + a ServiceRecord (a completed service
-- event, the history), both anchored on the central Vehicle (ADR-0003) by an
-- onDelete: RESTRICT FK (the house posture). Hand-authored per the kickoff —
-- `prisma migrate dev` / `--create-only` are non-interactive-blocked in this
-- env. The canonical Prisma SQL was generated via `prisma migrate diff
-- --from-schema-datasource --to-schema-datamodel --script`; the four PRE-EXISTING
-- PostGIS drift steps that diff always emits (DROP INDEX geofence_geometry_idx /
-- gps_ping_geometry_idx + ALTER ... geometry DROP DEFAULT — the accepted
-- ADR-0029/0030 generated-column hybrid cost) are deliberately EXCLUDED so this
-- migration touches only the two new tables.

-- CreateEnum
CREATE TYPE "service_interval_type" AS ENUM ('DISTANCE_KM', 'ENGINE_HOURS', 'CALENDAR_DAYS');

-- CreateEnum
CREATE TYPE "service_schedule_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "service_schedule" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "intervalType" "service_interval_type" NOT NULL,
    "intervalValue" INTEGER NOT NULL,
    "status" "service_schedule_status" NOT NULL DEFAULT 'ACTIVE',
    "lastServiceAt" TIMESTAMP(3) NOT NULL,
    "lastServiceOdometerKm" INTEGER,
    "lastServiceEngineHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "service_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_record" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceScheduleId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "odometerKm" INTEGER,
    "engineHours" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "service_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_schedule_vehicleId_idx" ON "service_schedule"("vehicleId");

-- CreateIndex
CREATE INDEX "service_schedule_status_idx" ON "service_schedule"("status");

-- CreateIndex
CREATE INDEX "service_schedule_createdById_idx" ON "service_schedule"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "service_schedule_vehicleId_name_key" ON "service_schedule"("vehicleId", "name");

-- CreateIndex
CREATE INDEX "service_record_vehicleId_idx" ON "service_record"("vehicleId");

-- CreateIndex
CREATE INDEX "service_record_serviceScheduleId_idx" ON "service_record"("serviceScheduleId");

-- CreateIndex
CREATE INDEX "service_record_performedAt_idx" ON "service_record"("performedAt" DESC);

-- CreateIndex
CREATE INDEX "service_record_createdById_idx" ON "service_record"("createdById");

-- AddForeignKey
ALTER TABLE "service_schedule" ADD CONSTRAINT "service_schedule_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_schedule" ADD CONSTRAINT "service_schedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_record" ADD CONSTRAINT "service_record_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_record" ADD CONSTRAINT "service_record_serviceScheduleId_fkey" FOREIGN KEY ("serviceScheduleId") REFERENCES "service_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_record" ADD CONSTRAINT "service_record_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
