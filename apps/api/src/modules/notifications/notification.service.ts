import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { type Queue } from "bullmq";

// PrismaService and Mailer are injected by NestJS via emitDecoratorMetadata (see
// apps/api/tsconfig.json's experimentalDecorators+emitDecoratorMetadata pair);
// their class references must remain VALUE imports at runtime so the DI
// container can resolve them by token. Same eslint override as every other
// vertical-slice service that injects PrismaService.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Mailer } from "./mailer";
import { type MailMessage, type MailerSendResult } from "./mailer";
import {
  NOTIFICATION_QUEUE,
  REMINDER_SCAN_JOB_NAME,
  REMINDER_SCAN_CRON,
  REMINDER_SCAN_SCHEDULER_ID,
} from "./notification.constants";

/**
 * Counts a scan run produces — all SAFE operational values (no addresses, no
 * document contents) so the worker can put them on its span (ADR-0038 c4).
 */
export interface ReminderScanResult {
  /** Candidate due/overdue items the scan classified this run. */
  itemsConsidered: number;
  /** Items NOT already in the NotificationLog — the newly-crossed ones we email. */
  remindersNewlyDue: number;
  /** SEND jobs enqueued — one per recipient (the scan→send split). */
  sendJobsEnqueued: number;
}

/**
 * The payload of a SEND job. The scan computes one of these per recipient and
 * enqueues it; the worker hands it to {@link NotificationService.send}. C2's
 * later checkpoints extend this with the NotificationLog row ids the send
 * completes with the provider result (ADR-0038 c5 — the dedup ledger written at
 * scan time, completed at send time).
 */
export interface ReminderSendJobData {
  message: MailMessage;
}

/**
 * NotificationService — the daily reminder SCAN scheduler + the SEND executor
 * (ADR-0038 commitments 3–4), modelled on RetentionService. It owns the boot-
 * time registration of the single keyed repeatable scan and the two units of
 * work the @Processor worker dispatches to: {@link scan} (read sources → enqueue
 * sends) and {@link send} (deliver one digest via the Mailer).
 *
 * The compliance source, the NotificationLog dedup, the digest renderer, and the
 * per-recipient enqueue land in C2's later checkpoints (the NotificationLog
 * model + the source/digest/split). This checkpoint wires the module, the queue,
 * the scheduler, the worker, and the Mailer DI; `scan` therefore finds nothing
 * to send yet, which is the correct empty-digest behavior (ADR-0038 c4: an empty
 * digest enqueues nothing and sends nothing — no "all clear" email).
 */
@Injectable()
export class NotificationService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Register the single repeatable scan IDEMPOTENTLY at boot (ADR-0038 c3).
   * `upsertJobScheduler` is keyed on REMINDER_SCAN_SCHEDULER_ID, so each restart
   * UPSERTS the same entry instead of stacking a new repeatable per boot — a
   * restart cannot duplicate the schedule. Uses bullmq's Job Schedulers API (the
   * non-deprecated successor to `repeat`), exactly as RetentionService does.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      REMINDER_SCAN_SCHEDULER_ID,
      { pattern: REMINDER_SCAN_CRON },
      { name: REMINDER_SCAN_JOB_NAME },
    );
  }

  /**
   * Run one reminder scan: read the due/overdue sources, diff them against the
   * NotificationLog (send-once-per-lapse), build the digest, resolve recipients,
   * and enqueue one SEND job per recipient — returning SAFE counts for the
   * worker's span.
   *
   * The source/dedup/digest/enqueue body lands in C2's source+digest+split
   * checkpoint (it also gains a `now` parameter then, so the boundary is
   * deterministically testable); until then the scan has no wired source and
   * correctly enqueues nothing — the empty-digest behavior (ADR-0038 c4).
   */
  async scan(): Promise<ReminderScanResult> {
    return Promise.resolve({ itemsConsidered: 0, remindersNewlyDue: 0, sendJobsEnqueued: 0 });
  }

  /**
   * Deliver one digest email to one recipient via the injected Mailer. Called by
   * the worker for each SEND job. The Mailer REJECTS (never swallows) on a
   * provider error so the queue's bounded retry fires and, later, the C3
   * `reminder_delivery` SLI counts a failed attempt by the throw.
   */
  async send(data: ReminderSendJobData): Promise<MailerSendResult> {
    return this.mailer.send(data.message);
  }
}
