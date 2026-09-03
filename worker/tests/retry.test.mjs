import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableStatus, retryDelayMs, withTransientRetries } from "../src/retry.mjs";

test("identifies transient HTTP statuses", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
});

test("caps Retry-After and otherwise grows a bounded backoff", () => {
  assert.equal(retryDelayMs(1, 75_000), 60_000);
  assert.ok(retryDelayMs(1) >= 1_000);
  assert.ok(retryDelayMs(8) <= 36_000);
});

test("retries a transient request and preserves a permanent failure", async () => {
  let attempts = 0;
  const retried = [];
  const result = await withTransientRetries({
    attempt: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("socket closed"), { retryable: true });
      return "complete";
    },
    sleep: async () => undefined,
    onRetry: async (event) => retried.push(event),
  });
  assert.equal(result, "complete");
  assert.equal(attempts, 3);
  assert.equal(retried.length, 2);

  let permanentAttempts = 0;
  await assert.rejects(() => withTransientRetries({
    attempt: async () => {
      permanentAttempts += 1;
      throw Object.assign(new Error("invalid audio"), { retryable: false });
    },
    sleep: async () => undefined,
  }), /invalid audio/);
  assert.equal(permanentAttempts, 1);
});
