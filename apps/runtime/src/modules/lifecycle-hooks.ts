import type {
  LifecycleEventMap,
  LifecycleHooks,
  LifecycleListener,
} from "@oh-my-bug/module-api";

type LifecycleEventName = keyof LifecycleEventMap;
type StoredListener = (payload: never) => void;

interface ListenerRegistration {
  owner: string;
  listener: StoredListener;
}

export type LifecycleHookFailureHandler = (
  owner: string,
  hook: string,
  error: unknown,
) => void;

export interface LifecycleHookFailure {
  owner: string;
  hook: LifecycleEventName;
  error: unknown;
}

export class RuntimeLifecycleHooks implements LifecycleHooks {
  private readonly listeners = new Map<LifecycleEventName, ListenerRegistration[]>();
  private readonly failures: LifecycleHookFailure[] = [];

  constructor(private readonly onFailure: LifecycleHookFailureHandler = () => {}) {}

  on<K extends LifecycleEventName>(
    owner: string,
    name: K,
    listener: LifecycleListener<K>,
  ): () => void {
    const registration: ListenerRegistration = {
      owner,
      listener: listener as StoredListener,
    };
    const registrations = this.listeners.get(name) ?? [];
    registrations.push(registration);
    this.listeners.set(name, registrations);
    return () => {
      const current = this.listeners.get(name);
      if (!current) return;
      const index = current.indexOf(registration);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.listeners.delete(name);
    };
  }

  emit<K extends LifecycleEventName>(name: K, payload: LifecycleEventMap[K]): void {
    for (const registration of [...this.listeners.get(name) ?? []]) {
      try {
        registration.listener(payload as never);
      } catch (error) {
        this.failures.push({ owner: registration.owner, hook: name, error });
        this.onFailure(registration.owner, name, error);
      }
    }
  }

  takeFailures(): LifecycleHookFailure[] {
    return this.failures.splice(0);
  }
}
