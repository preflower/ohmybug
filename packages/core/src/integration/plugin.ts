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
  section: z.string().regex(/^[a-z][a-zA-Z0-9]*$/).optional(),
  placeholder: z.string().trim().min(1).optional(),
};

export const configFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...fieldBase, type: z.literal("string"), defaultValue: z.string().optional() }).strict(),
  z.object({
    ...fieldBase,
    type: z.literal("string[]"),
    defaultValue: z.array(z.string()).optional(),
    addLabel: z.string().trim().min(1).optional(),
  }).strict(),
  z.object({ ...fieldBase, type: z.literal("number"), defaultValue: z.number().optional() }).strict(),
  z.object({ ...fieldBase, type: z.literal("boolean"), defaultValue: z.boolean().optional() }).strict(),
]);

export const secretFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  required: z.boolean(),
  section: z.string().regex(/^[a-z][a-zA-Z0-9]*$/).optional(),
  placeholder: z.string().trim().min(1).optional(),
}).strict();

const staticIntegrationSummarySchema = z.object({
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
}).strict();

const configIntegrationSummarySchema = z.object({
  fields: z.array(z.object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
    emptyValue: z.string().trim().min(1),
    valuePrefix: z.string().min(1).optional(),
  }).strict()).min(1),
  separator: z.string().min(1).optional(),
}).strict();

export const integrationSectionSchema = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  summary: z.union([
    staticIntegrationSummarySchema,
    configIntegrationSummarySchema,
  ]).optional(),
  collapsed: z.boolean().optional(),
  connectionTest: z.boolean().optional(),
}).strict();

export const integrationConnectionTestResultSchema = z.object({
  title: z.string().trim().min(1).max(120),
  details: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(240),
  }).strict()).max(8),
  testedAt: z.iso.datetime(),
}).strict();

export const integrationPluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().trim().min(1),
  icon: z.enum(["plug", "messageCircle", "webhook", "sentry", "dingtalk"]).optional(),
  description: z.string().trim().min(1).optional(),
  sections: z.array(integrationSectionSchema).optional(),
  configFields: z.array(configFieldSchema),
  secretFields: z.array(secretFieldSchema),
}).strict().superRefine((manifest, context) => {
  const sections = new Set<string>();
  let connectionTestSections = 0;
  const configKeys = new Set(manifest.configFields.map((field) => field.key));
  const secretKeys = new Set(manifest.secretFields.map((field) => field.key));
  for (const [index, section] of (manifest.sections ?? []).entries()) {
    if (sections.has(section.id)) {
      context.addIssue({
        code: "custom",
        path: ["sections", index, "id"],
        message: "DUPLICATE_INTEGRATION_SECTION",
      });
    }
    sections.add(section.id);
    if (section.connectionTest) {
      connectionTestSections += 1;
      if (connectionTestSections > 1) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "connectionTest"],
          message: "DUPLICATE_INTEGRATION_CONNECTION_TEST",
        });
      }
    }
    if (section.summary && "fields" in section.summary) {
      for (const [fieldIndex, field] of section.summary.fields.entries()) {
        if (secretKeys.has(field.key)) {
          context.addIssue({
            code: "custom",
            path: ["sections", index, "summary", "fields", fieldIndex, "key"],
            message: "INTEGRATION_SUMMARY_SECRET_FORBIDDEN",
          });
        } else if (!configKeys.has(field.key)) {
          context.addIssue({
            code: "custom",
            path: ["sections", index, "summary", "fields", fieldIndex, "key"],
            message: "INTEGRATION_SUMMARY_FIELD_NOT_FOUND",
          });
        }
      }
    }
  }
  for (const [collection, fields] of [
    ["configFields", manifest.configFields],
    ["secretFields", manifest.secretFields],
  ] as const) {
    for (const [index, field] of fields.entries()) {
      if (field.section && !sections.has(field.section)) {
        context.addIssue({
          code: "custom",
          path: [collection, index, "section"],
          message: "INTEGRATION_SECTION_NOT_FOUND",
        });
      }
    }
  }
});

export type ConfigField = z.infer<typeof configFieldSchema>;
export type SecretField = z.infer<typeof secretFieldSchema>;
export type IntegrationSection = z.infer<typeof integrationSectionSchema>;
export type IntegrationPluginManifest = z.infer<typeof integrationPluginManifestSchema>;
export type IntegrationConnectionTestResult = z.infer<typeof integrationConnectionTestResultSchema>;

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

export interface IntegrationPluginConnectionTestContext {
  projectId: string;
  configuration: ProjectIntegrationConfiguration;
  secrets: Readonly<Record<string, string>>;
  now(): Date;
}

export interface IntegrationPlugin {
  readonly manifest: IntegrationPluginManifest;
  validate(configuration: ProjectIntegrationConfiguration): void;
  create(context: IntegrationPluginContext): Promise<ManagedIntegrationSource>;
  testConnection?(
    context: IntegrationPluginConnectionTestContext,
  ): Promise<IntegrationConnectionTestResult>;
  publicError(error: unknown): string;
}

export type { ConfigValue };
