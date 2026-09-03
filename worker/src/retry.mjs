const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(status);
}

export function retryDelayMs(attempt, retryAfterMs) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return Math.min(retryAfterMs, 60_000);
  const exponential = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  // A small deterministic jitter keeps parallel workers from retrying in lockstep.
  return exponential + Math.round(exponential * ((attempt * 37) % 100) / 500);
}

export async function withTransientRetries({ attempt, maxAttempts = 4, onRetry = () => undefined, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let lastError;
  for (let number = 1; number <= maxAttempts; number++) {
    try {
      return await attempt(number);
    } catch (error) {
      lastError = error;
      const retryable = Boolean(error && typeof error === "object" && "retryable" in error && error.retryable);
      if (!retryable || number === maxAttempts) throw error;
      const retryAfterMs = typeof error === "object" && error && "retryAfterMs" in error ? Number(error.retryAfterMs) : undefined;
      const delayMs = retryDelayMs(number, retryAfterMs);
      await onRetry({ attempt: number, nextAttempt: number + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError ?? new Error("Retry attempts were exhausted.");
}
