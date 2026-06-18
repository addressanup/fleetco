import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ServiceRecordsController } from "./service-records.controller";
import { ServiceRecordsService } from "./service-records.service";
import { ServiceSchedulesController } from "./service-schedules.controller";
import { ServiceSchedulesService } from "./service-schedules.service";

// MaintenanceModule — the preventive-maintenance aggregate (ADR-0037 / Program
// B). Owns TWO related aggregates anchored on the central Vehicle (ADR-0003):
//   - ServiceSchedule — a recurring maintenance interval for a vehicle
//     (DISTANCE_KM / ENGINE_HOURS / CALENDAR_DAYS), from which "next due" is
//     derived (the due/overdue badge lands in B4).
//   - ServiceRecord — a completed service event (the history), optionally
//     linked to the schedule it satisfies; the ExpenseLog cost-link lands in B4.
//
// AuthModule is imported (not just AuthGuard listed in providers) so the AUTH
// provider is available to the guard at request time — see AuthModule's exports
// ([AUTH, AuthGuard]) and ADR-0021 §6. Same pattern every other aggregate
// module follows.
//
// Both services are exported so B4 (the due/overdue surface + the anchor-advance
// $transaction on a ServiceRecord write) and any future caller can use them
// without a circular import through the controller layer.
@Module({
  imports: [AuthModule],
  controllers: [ServiceSchedulesController, ServiceRecordsController],
  providers: [ServiceSchedulesService, ServiceRecordsService],
  exports: [ServiceSchedulesService, ServiceRecordsService],
})
export class MaintenanceModule {}
