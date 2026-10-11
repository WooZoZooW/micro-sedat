export function createRateLimiter({ windowMs = 600000, max = 12, now = Date.now } = {}) {
  const hits = new Map();

  function prune(timestamp) {
    if (hits.size < 10000) return;
    for (const [key, entry] of hits) {
      if (entry.reset <= timestamp) hits.delete(key);
    }
  }

  return {
    check(key) {
      const timestamp = now();
      prune(timestamp);
      const entry = hits.get(key);
      if (!entry || entry.reset <= timestamp) {
        hits.set(key, { count: 1, reset: timestamp + windowMs });
        return { allowed: true, retryAfterMs: 0 };
      }
      entry.count += 1;
      if (entry.count > max) {
        return { allowed: false, retryAfterMs: Math.max(0, entry.reset - timestamp) };
      }
      return { allowed: true, retryAfterMs: 0 };
    },
    reset() {
      hits.clear();
    },
    get size() {
      return hits.size;
    },
  };
}
