export interface TrayNavigationTarget {
  issueId?: string;
}

export class TrayNavigationQueue {
  private ready = false;
  private pending?: TrayNavigationTarget;

  constructor(private readonly send: (target: TrayNavigationTarget) => void) {}

  setReady(ready: boolean): void {
    this.ready = ready;
    this.flush();
  }

  request(target: TrayNavigationTarget): void {
    this.pending = target;
    this.flush();
  }

  private flush(): void {
    if (!this.ready || !this.pending) return;
    const target = this.pending;
    this.pending = undefined;
    this.send(target);
  }
}
