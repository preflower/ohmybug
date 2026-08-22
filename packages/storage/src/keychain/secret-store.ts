import { getKeyring, initBackend, type SecretStorageBackend } from "cross-keychain";

export interface SecretStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async get(ref: string): Promise<string | null> {
    return this.values.get(ref) ?? null;
  }

  async set(ref: string, value: string): Promise<void> {
    this.values.set(ref, value);
  }

  async delete(ref: string): Promise<void> {
    this.values.delete(ref);
  }
}

export class LocalSecretStore implements SecretStore {
  private readonly backend: Promise<SecretStorageBackend>;

  constructor(private readonly service = "oh-my-bug") {
    this.backend = initializeSecureBackend();
  }

  async get(ref: string): Promise<string | null> {
    return (await this.backend).getPassword(this.service, ref);
  }

  async set(ref: string, value: string): Promise<void> {
    await (await this.backend).setPassword(this.service, ref, value);
  }

  async delete(ref: string): Promise<void> {
    await (await this.backend).deletePassword(this.service, ref);
  }
}

async function initializeSecureBackend(): Promise<SecretStorageBackend> {
  await initBackend((backend) => backend.id !== "file" && backend.id !== "null");
  const backend = await getKeyring();
  if (backend.id === "file" || backend.id === "null") throw new Error("SECURE_KEYCHAIN_REQUIRED");
  return backend;
}
