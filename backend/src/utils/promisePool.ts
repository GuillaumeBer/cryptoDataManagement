export interface PromisePoolOptions {
  concurrency?: number;
  delayMs?: number;
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
      if (nextIndex >= items.length) {
        break;
      }
      currentIndex = nextIndex++;
      await worker(items[currentIndex], currentIndex);
      const shouldDelay = delayMs > 0 && nextIndex < items.length;
      if (shouldDelay) {
        await sleep(delayMs);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
}
