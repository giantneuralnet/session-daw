// Require sustained silence longer than the longest echo interval (1.125 s).
export class TailMonitor {
  private quietSince: number | null = null;
  private threshold: number;
  private quietSeconds: number;
  constructor(threshold = 0.0001, quietSeconds = 2) {
    this.threshold = threshold;
    this.quietSeconds = quietSeconds;
  }
  update(now: number, peak: number, sourcesFinished: boolean) {
    if (!sourcesFinished || peak > this.threshold) {
      this.quietSince = null;
      return false;
    }
    this.quietSince ??= now;
    return now - this.quietSince >= this.quietSeconds;
  }
}
