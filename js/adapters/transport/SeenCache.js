// Deduplicates flooded frames. The mesh relays every frame to every neighbor, so
// the same mid arrives many times; we process each exactly once and drop the
// rest, which also stops relay loops. A bounded ring buffer keeps memory flat:
// the oldest mids are forgotten once the window is full.

const MAX_REMEMBERED = 500;

export class SeenCache {
  constructor(limit = MAX_REMEMBERED) {
    this.limit = limit;
    this.seen = new Set();
    this.order = []; // insertion order, so we can evict the oldest
  }

  // Returns true the first time a mid is seen, false on every repeat.
  markSeen(mid) {
    if (this.seen.has(mid)) return false;
    this.seen.add(mid);
    this.order.push(mid);
    if (this.order.length > this.limit) {
      this.seen.delete(this.order.shift());
    }
    return true;
  }
}
