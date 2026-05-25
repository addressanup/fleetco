// CI polling.
//
// After the agent opens a PR, the loop polls `gh pr checks <N>` until either
// all checks pass (green) or any check fails (red). Timeout per `limits.ciPollTimeoutMs`.
// Halts the loop cleanly on red or timeout (principle 1: honor discipline gates
// absolutely; principle 10: no CI auto-fix retry).
//
// Edge case: if `.github/workflows/` has no yml files on main, the loop CANNOT
// enforce the green-before-merge gate, so it halts with a clear "no CI configured"
// message. The operator must complete the CI bootstrap PR manually before the
// loop can take over.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { limits, paths } from "./config.js";

const execFileAsync = promisify(execFile);

export type CiOutcome =
  | { status: "green" }
  | { status: "red"; failedCheck?: string; details: string }
  | { status: "no_workflows"; details: string }
  | { status: "timeout"; details: string };

export function hasCiWorkflows(repoRoot: string = paths.repoRoot): boolean {
  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  try {
    if (!fs.existsSync(workflowsDir)) return false;
    const entries = fs.readdirSync(workflowsDir);
    return entries.some((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    return false;
  }
}

export interface PollOptions {
  /** Polling interval in ms. */
  intervalMs?: number;
  /** Hard timeout in ms (default from config). */
  timeoutMs?: number;
  /** Optional callback fired before each poll (for notifications during long waits). */
  onPoll?: (elapsed: number) => void;
  /** Override the gh runner for tests. */
  runGh?: (args: readonly string[]) => Promise<{ stdout: string; exitCode: number }>;
}

const defaultRunGh = async (
  args: readonly string[],
): Promise<{ stdout: string; exitCode: number }> => {
  try {
    const { stdout } = await execFileAsync("gh", [...args], {
      cwd: paths.repoRoot,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; code?: number };
    return { stdout: e.stdout ?? "", exitCode: typeof e.code === "number" ? e.code : 1 };
  }
};

export async function pollCi(prNumber: number, options: PollOptions = {}): Promise<CiOutcome> {
  if (!hasCiWorkflows()) {
    return {
      status: "no_workflows",
      details:
        "No .yml/.yaml files in .github/workflows/. Per principle 1 (honor discipline gates), the loop refuses to operate without CI. Operator must complete the CI bootstrap PR before launching the loop.",
    };
  }

  const intervalMs = options.intervalMs ?? limits.ciPollIntervalMs;
  const timeoutMs = options.timeoutMs ?? limits.ciPollTimeoutMs;
  const runGh = options.runGh ?? defaultRunGh;
  const startedAt = Date.now();

  while (true) {
    if (options.onPoll) options.onPoll(Date.now() - startedAt);
    // `gh pr checks --json` returns rows shaped like:
    //   { name, state: "SUCCESS"|"FAILURE"|"PENDING"|"IN_PROGRESS"|..., bucket: "pass"|"fail"|"pending"|"skipping" }
    // The `bucket` field rolls up the many possible `state` values into three
    // coarse buckets, which is what we actually want here. We also include
    // `state` in the query so a failed-check message can include the precise
    // GitHub state (e.g. "FAILURE" vs "CANCELLED" vs "TIMED_OUT").
    //
    // Earlier versions of this code queried `--json state,conclusion` and
    // checked `state === "COMPLETED"` — that's the GraphQL CheckRun schema,
    // NOT the `gh pr checks` JSON schema. The conditions never matched,
    // and the loop polled until timeout regardless of CI outcome. Surfaced
    // by iter 2 of the Phase 1 Vehicles slice (PR #25): CI failed at 28s,
    // but the loop polled for 45min and halted with ci_timeout.
    const { stdout, exitCode } = await runGh([
      "pr",
      "checks",
      String(prNumber),
      "--json",
      "name,state,bucket",
    ]);
    if (exitCode === 0) {
      try {
        const checks = JSON.parse(stdout) as {
          name: string;
          state: string;
          bucket: string;
        }[];
        // Treat empty checks array as "no checks reported yet" — keep waiting.
        if (checks.length > 0) {
          const anyFailed = checks.some((c) => c.bucket === "fail");
          const allFinal = checks.every(
            (c) => c.bucket === "pass" || c.bucket === "fail" || c.bucket === "skipping",
          );
          if (anyFailed) {
            const failed = checks.find((c) => c.bucket === "fail");
            return {
              status: "red",
              ...(failed ? { failedCheck: `${failed.name} (${failed.state})` } : {}),
              details: `Failed check on PR #${prNumber}. Operator must inspect; the loop does NOT auto-fix (principle 10).`,
            };
          }
          if (allFinal) {
            return { status: "green" };
          }
        }
      } catch {
        // JSON parse failure — keep polling; might be transient.
      }
    }
    // exitCode 8 from gh = "no checks reported"; keep waiting.
    if (Date.now() - startedAt > timeoutMs) {
      return {
        status: "timeout",
        details: `CI poll exceeded ${Math.round(timeoutMs / 60_000)}min on PR #${prNumber}. Operator must inspect.`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
