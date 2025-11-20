import { RateLimiter } from './rateLimiter';

export interface PromisePoolOptions {
  concurrency?: number;
  delayMs?: number;
  rateLimiter?: RateLimiter;
  weight?: number; // Weight per item for the rate limiter (default 1)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPromisePool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  options: PromisePoolOptions = {}
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? 0));
  const workerCount = Math.min(concurrency, items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      let currentIndex: number;

      // Atomic-ish index reservation
      if (nextIndex >= items.length) {
        break;
      }
      currentIndex = nextIndex++;

      // Rate limiting
      if (options.rateLimiter) {
        await options.rateLimiter.consume(options.weight ?? 1);
      }

      await worker(items[currentIndex], currentIndex);

      // Fixed delay (legacy mode or additional safety)
      // Only sleep if we are not using a rate limiter, or if explicit delay is requested on top
      // Usually if rateLimiter is present, delayMs should probably be 0, but we respect it if set.
      const shouldDelay = delayMs > 0 && nextIndex < items.length;
      if (shouldDelay) {
        await sleep(delayMs);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
}
