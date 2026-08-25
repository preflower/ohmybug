interface ActiveIssueOperation {
  controller: AbortController;
  done: Promise<unknown>;
}

export class IssueOperationCoordinator {
  private readonly active = new Map<string, ActiveIssueOperation>();

  async run<T>(issueId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.active.has(issueId)) throw new Error("ISSUE_OPERATION_ALREADY_ACTIVE");
    const controller = new AbortController();
    const done = Promise.resolve().then(() => operation(controller.signal));
    const active = { controller, done };
    this.active.set(issueId, active);
    try {
      return await done;
    } finally {
      if (this.active.get(issueId) === active) this.active.delete(issueId);
    }
  }

  async interrupt(issueId: string): Promise<void> {
    const active = this.active.get(issueId);
    if (!active) return;
    active.controller.abort(new Error("ISSUE_PAUSED"));
    await active.done;
  }

  isActive(issueId: string): boolean { return this.active.has(issueId); }
}
