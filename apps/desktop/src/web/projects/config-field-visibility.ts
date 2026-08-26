import type { ConfigValue, IntegrationPluginManifest } from "../api/types.js";

type ConfigField = IntegrationPluginManifest["configFields"][number];

export function isConfigFieldVisible(
  field: ConfigField,
  fields: ConfigField[],
  config: Record<string, ConfigValue>,
): boolean {
  if (!field.visibleWhen) return true;
  const controller = fields.find((candidate) => candidate.key === field.visibleWhen?.key);
  const value = config[field.visibleWhen.key] ?? controller?.defaultValue;
  return JSON.stringify(value) === JSON.stringify(field.visibleWhen.equals);
}

export function withConditionalConfigDefaults(
  fields: ConfigField[],
  stored: Record<string, ConfigValue>,
): Record<string, ConfigValue> {
  const hydrated: Record<string, ConfigValue> = Object.fromEntries(fields.flatMap((field) =>
    field.defaultValue === undefined ? [] : [[field.key, field.defaultValue]],
  ));
  Object.assign(hydrated, stored);
  for (const field of fields) {
    if (!field.visibleWhen || field.visibleWhen.key in stored || !hasValue(stored[field.key])) continue;
    hydrated[field.visibleWhen.key] = field.visibleWhen.equals;
  }
  return hydrated;
}

function hasValue(value: ConfigValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  return value !== undefined;
}
