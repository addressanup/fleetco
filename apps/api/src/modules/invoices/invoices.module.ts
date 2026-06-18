import { Module } from "@nestjs/common";

import { env } from "../../config/env";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { TripsModule } from "../trips/trips.module";
import { InvoiceNumberingService } from "./invoice-numbering.service";
import { InvoicePdfRenderer } from "./invoice-pdf-renderer";
import { InvoiceSettingsService } from "./invoice-settings.service";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { MockObjectStorage } from "./mock.object-storage";
import { ObjectStorage } from "./object-storage";
import { PdfkitInvoiceRenderer } from "./pdfkit.invoice-pdf-renderer";
import { R2ObjectStorage } from "./r2.object-storage";

// InvoicesModule — FleetCo's FIRST revenue-side aggregate (Program D / ADR-0039),
// the Invoice + InvoiceLine pair built from the Customer -> Job -> Trip chain.
//
// AuthModule is imported (not just AuthGuard listed in providers) so the AUTH
// provider is available to the guard at request time — see AuthModule's exports
// ([AUTH, AuthGuard]) and ADR-0021 §6. Same pattern Customers / Jobs / Geofences
// follow.
//
// InvoicesService is exported so later tickets that need to read or assemble an
// invoice (D3's issue flow, D4's build-from-trips, D5's PDF render) can reach the
// public service interface without a circular import through the controller.
//
// D1 ships the READ path only (list / detail). Later tickets layer the write
// path, the issue lifecycle, the PDF/R2 storage, and the web surface on top.
//
// D4 (build-from-job/trips) imports JobsModule + TripsModule so InvoicesService can
// read the job (customer-consistency + the line-description fallback) and the trips
// (their dates) through those modules' PUBLIC service interfaces — never their
// tables (ADR-0039 c8 + the CLAUDE.md cross-module rule). No cycle: neither Jobs nor
// Trips depends on Invoices. Both modules export their service (and import AuthModule,
// which provides TripsService's DriverScopeService dependency), so the imports
// resolve cleanly.
// THE PDF + R2 DI (ADR-0039 c6/c7, D5):
//   • InvoicePdfRenderer → PdfkitInvoiceRenderer always: rendering needs no
//     env/creds (pdfkit is pure-Node), so the renderer is always available (the
//     useFactory mirrors NotificationModule's Mailer wiring).
//   • ObjectStorage → R2ObjectStorage in production (where the operator supplies
//     the four R2_* creds) and the no-network MockObjectStorage everywhere they
//     are absent (dev / test / CI), so the API never reaches R2 outside
//     production — exactly the Mailer's ResendMailer/MockMailer split. The factory
//     is keyed on the R2 creds' presence (read through the typed env, never
//     logged). issue() ALSO guards on storage.isConfigured() so an unconfigured
//     store refuses issue with a clear 422 rather than silently mocking in prod.
// Tests OVERRIDE these providers with recording stubs to assert render/store.
@Module({
  imports: [AuthModule, JobsModule, TripsModule],
  controllers: [InvoicesController],
  // InvoiceNumberingService (gapless numbering) and InvoiceSettingsService
  // (FleetCo's supplier-PAN config) are the D3 issue-flow collaborators;
  // InvoicePdfRenderer + ObjectStorage are the D5 render+store collaborators —
  // all providers, not exported: InvoicesService consumes them internally.
  providers: [
    InvoicesService,
    InvoiceNumberingService,
    InvoiceSettingsService,
    {
      provide: InvoicePdfRenderer,
      useFactory: (): InvoicePdfRenderer => new PdfkitInvoiceRenderer(),
    },
    {
      provide: ObjectStorage,
      useFactory: (): ObjectStorage =>
        env.R2_ENDPOINT !== undefined &&
        env.R2_ENDPOINT !== "" &&
        env.R2_ACCESS_KEY_ID !== undefined &&
        env.R2_ACCESS_KEY_ID !== "" &&
        env.R2_SECRET_ACCESS_KEY !== undefined &&
        env.R2_SECRET_ACCESS_KEY !== "" &&
        env.R2_BUCKET !== undefined &&
        env.R2_BUCKET !== ""
          ? new R2ObjectStorage()
          : new MockObjectStorage(),
    },
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
