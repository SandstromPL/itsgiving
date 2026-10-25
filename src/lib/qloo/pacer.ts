/**
 * Spaces out request starts so that no more than `perWindow` begin in any `windowMs`. Qloo counts calls per key in
 * one-second windows and answers 429 past its limit; pacing just under it makes a burst wait a moment instead.
 */
export class Pacer {
  /** Start times already handed out, oldest first. While a burst waits its turn, some are in the future. */
  private starts: number[] = [];

  constructor(
    private readonly perWindow: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Books the next start and returns how long to wait before making the call: 0 when the window has room. */
  reserve(): number {
    const now = this.now();
    while (this.starts.length > 0 && this.starts[0] <= now - this.windowMs) this.starts.shift();
    const blocking = this.starts.length >= this.perWindow ? this.starts[this.starts.length - this.perWindow] : undefined;
    const at = blocking === undefined ? now : Math.max(now, blocking + this.windowMs);
    this.starts.push(at);
    return at - now;
  }
}
