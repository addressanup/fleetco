import { describe, it, expect, vi } from "vitest";
import { pollCi } from "../src/ci-poll.js";

// Regression for the iter-2-of-Phase-1 ci_timeout incident (PR #25): the
// previous query asked `--json state,conclusion` and checked `state ===
// "COMPLETED"`, which is the GraphQL CheckRun schema, NOT the gh-CLI schema.
// The actual gh JSON returns `state: "SUCCESS"|"FAILURE"|"PENDING"|...` and
// `bucket: "pass"|"fail"|"pending"|"skipping"`. With the wrong fields, the
// loop polled until the 45-min timeout regardless of green or red CI.

// Each test mocks the gh CLI runner to return canonical gh-CLI JSON shapes
// and asserts pollCi returns the right status quickly.

function mockGh(output: string) {
  return vi.fn(async () => ({ stdout: output, exitCode: 0 }));
}

// Override hasCiWorkflows via filesystem isn't possible in unit tests; we
// use a small intervalMs + short timeout so polls happen fast in tests.
const fastOpts = { intervalMs: 5, timeoutMs: 2000 };

describe("pollCi — gh pr checks JSON parsing", () => {
  it("returns green when all checks have bucket pass", async () => {
    const runGh = mockGh(
      JSON.stringify([
        { name: "lint", state: "SUCCESS", bucket: "pass" },
        { name: "semgrep", state: "SUCCESS", bucket: "pass" },
      ]),
    );
    const result = await pollCi(99, { ...fastOpts, runGh });
    expect(result.status).toBe("green");
    expect(runGh).toHaveBeenCalledOnce();
  });

  it("returns red when any check has bucket fail (the iter-2 PR #25 scenario)", async () => {
    const runGh = mockGh(
      JSON.stringify([
        { name: "lint + format + typecheck + tests", state: "FAILURE", bucket: "fail" },
        { name: "semgrep (OWASP + security-audit)", state: "SUCCESS", bucket: "pass" },
      ]),
    );
    const result = await pollCi(25, { ...fastOpts, runGh });
    expect(result.status).toBe("red");
    if (result.status === "red") {
      expect(result.failedCheck).toContain("lint + format + typecheck + tests");
      expect(result.failedCheck).toContain("FAILURE");
    }
  });

  it("returns red when state is CANCELLED (bucket=fail covers all non-pass terminals)", async () => {
    const runGh = mockGh(JSON.stringify([{ name: "ci", state: "CANCELLED", bucket: "fail" }]));
    const result = await pollCi(99, { ...fastOpts, runGh });
    expect(result.status).toBe("red");
    if (result.status === "red") {
      expect(result.failedCheck).toContain("CANCELLED");
    }
  });

  it("treats bucket=skipping as final (green if no failures alongside)", async () => {
    const runGh = mockGh(
      JSON.stringify([
        { name: "ci", state: "SUCCESS", bucket: "pass" },
        { name: "optional", state: "SKIPPED", bucket: "skipping" },
      ]),
    );
    const result = await pollCi(99, { ...fastOpts, runGh });
    expect(result.status).toBe("green");
  });

  it("keeps polling while checks are still pending, then sees green", async () => {
    let call = 0;
    const runGh = vi.fn(async () => {
      call++;
      if (call < 3) {
        return {
          stdout: JSON.stringify([{ name: "ci", state: "IN_PROGRESS", bucket: "pending" }]),
          exitCode: 0,
        };
      }
      return {
        stdout: JSON.stringify([{ name: "ci", state: "SUCCESS", bucket: "pass" }]),
        exitCode: 0,
      };
    });
    const result = await pollCi(99, { ...fastOpts, runGh });
    expect(result.status).toBe("green");
    expect(runGh).toHaveBeenCalledTimes(3);
  });

  it("returns timeout when polling exceeds timeoutMs without resolution", async () => {
    const runGh = mockGh(JSON.stringify([{ name: "ci", state: "PENDING", bucket: "pending" }]));
    const result = await pollCi(99, { intervalMs: 10, timeoutMs: 50, runGh });
    expect(result.status).toBe("timeout");
  });

  it("treats empty checks array as still-pending (gh sometimes returns [])", async () => {
    let call = 0;
    const runGh = vi.fn(async () => {
      call++;
      if (call < 2) return { stdout: "[]", exitCode: 0 };
      return {
        stdout: JSON.stringify([{ name: "ci", state: "SUCCESS", bucket: "pass" }]),
        exitCode: 0,
      };
    });
    const result = await pollCi(99, { ...fastOpts, runGh });
    expect(result.status).toBe("green");
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  it("survives transient JSON parse error and keeps polling", async () => {
    let call = 0;
    const runGh = vi.fn(async () => {
      call++;
      if (call < 2) return { stdout: "not json", exitCode: 0 };
      return {
        stdout: JSON.stringify([{ name: "ci", state: "SUCCESS", bucket: "pass" }]),
        exitCode: 0,
      };
    });
    const result = await pollCi(99, { ...fastOpts, runGh });
    expect(result.status).toBe("green");
  });
});
