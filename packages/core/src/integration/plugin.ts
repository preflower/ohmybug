import { z } from "zod";

import type { IntegrationCheckpointStore } from "../ports/integration-checkpoint-store.js";
import type {
  ConfigValue,
  ProjectIntegrationConfiguration,
} from "../runtime/types.js";
import type { IntegrationInput } from "./input.js";

const fieldBase = {
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  required: z.boolean(),
};

export const configFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...fieldBase, type: z.literal("string"), defaultValue: z.string().optional() }).strict(),
  z.object({ ...fieldBase, type: z.literal("string[]"), defaultValue: z.array(z.string()).optional() }).strict(),
  z.object({ ...fieldBase, type: z.literal("number"), defaultValue: z.number().optional() }).strict(),
  z.object({ ...fieldBase, type: z.literal("boolean"), defaultValue: z.boolean().optional() }).strict(),
]);

export const secretFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  required: z.boolean(),
}).strict();

export const integrationPluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().trim().min(1),
  configFields: z.array(configFieldSchema),
  secretFields: z.array(secretFieldSchema),
}).strict();

export type ConfigField = z.infer<typeof configFieldSchema>;
export type SecretField = z.infer<typeof secretFieldSchema>;
export type IntegrationPluginManifest = z.infer<typeof integrationPluginManifestSchema>;

export interface IntegrationHealth {
  state: "stopped" | "connecting" | "connected" | "backoff";
  lastSuccessAt?: string;
  lastError?: string;
  nextRetryAt?: string;
}

export interface ManagedIntegrationSource {
  start(signal: AbortSignal): Promise<void>;
  health(): Readonly<IntegrationHealth>;
}

export interface IntegrationPluginContext {
  projectId: string;
  configuration: ProjectIntegrationConfiguration;
  secrets: Readonly<Record<string, string>>;
  checkpoints: IntegrationCheckpointStore;
  onInput(input: IntegrationInput): Promise<void>;
  id(): string;
  now(): Date;
}

export interface IntegrationPlugin {
  readonly manifest: IntegrationPluginManifest;
  validate(configuration: ProjectIntegrationConfiguration): void;
  create(context: IntegrationPluginContext): Promise<ManagedIntegrationSource>;
  publicError(error: unknown): string;
}

export type { ConfigValue };
