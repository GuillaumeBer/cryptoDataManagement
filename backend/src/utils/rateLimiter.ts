// import { logger } from './logger'; // unused

interface QueueItem {
  weight: number;
  resolve: () => void;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per ms
  // private readonly interval: number; // ms (unused in method logic, but kept for clarity in constructor)
  private queue: QueueItem[] = [];
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param capacity Max number of tokens (e.g., requests or weight)
   * @param interval Time interval in ms for the capacity (default: 60000ms = 1 minute)
   */
  constructor(capacity: number, interval: number = 60000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.lastRefill = Date.now();
    // this.interval = interval; // unused
    this.refillRate = capacity / interval;
  }

  /**
   * Consume tokens. If not enough tokens are available, waits until they are.
   * @param weight Cost of the operation
   */
  async consume(weight: number = 1): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push({ weight, resolve });
      this.processQueue();
    });
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed > 0) {
      const newTokens = elapsed * this.refillRate;
      this.tokens = Math.min(this.capacity, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }

  private processQueue() {
    this.refill();

    while (this.queue.length > 0) {
      const item = this.queue[0];

      if (this.tokens >= item.weight) {
        this.tokens -= item.weight;
        // Remove from queue and resolve
        this.queue.shift();
        item.resolve();
      } else {
        // Not enough tokens. Calculate time until we have enough.
        // We need (item.weight - current_tokens) more tokens.
        // Time = needed / rate
        const deficit = item.weight - this.tokens;
        const waitTime = Math.ceil(deficit / this.refillRate);

        // Ensure we wait at least 10ms to avoid tight loops or excessively small timeouts
        const safeWaitTime = Math.max(10, waitTime);

        if (!this.timer) {
          this.timer = setTimeout(() => {
            this.timer = null;
            this.processQueue();
          }, safeWaitTime);
        }

        // Cannot process more items until we refill
        break;
      }
    }
  }

  /**
   * Get current stats
   */
  getStats() {
    this.refill();
    return {
      tokens: this.tokens,
      queueLength: this.queue.length,
      capacity: this.capacity
    };
  }
}
