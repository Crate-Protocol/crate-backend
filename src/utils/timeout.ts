/**
 * Wraps a promise-returning function in a timeout using AbortController.
 * If the timeout expires before the promise resolves, it rejects with a TimeoutError.
 */
export async function withTimeout<T>(
  promiseFn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      promiseFn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error("TimeoutError"));
        });
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
