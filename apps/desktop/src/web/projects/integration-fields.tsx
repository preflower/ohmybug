import type { ConfigValue, IntegrationPluginManifest } from "../api/types.js";

import { Input } from "../components/ui/input.js";
import { ConfigFields } from "./config-fields.js";

interface IntegrationFieldsProps {
  manifest: IntegrationPluginManifest;
  config: Record<string, ConfigValue>;
  secretConfigured: Record<string, boolean>;
  secretValues: Record<string, string>;
  onConfigChange(key: string, value: ConfigValue): void;
  onSecretChange(key: string, value: string): void;
}

export function IntegrationFields({
  manifest,
  config,
  secretConfigured,
  secretValues,
  onConfigChange,
  onSecretChange,
}: IntegrationFieldsProps) {
  return <div className="form-grid">
    <ConfigFields fields={manifest.configFields} config={config} idPrefix={manifest.id} onChange={onConfigChange} />
    {manifest.secretFields.map((field) => <label key={field.key}>{field.label}
      <Input autoComplete="off" placeholder={secretConfigured[field.key] ? "已配置；输入新值可替换" : undefined} required={field.required && !secretConfigured[field.key]} type="password" value={secretValues[field.key] ?? ""} onChange={(event) => onSecretChange(field.key, event.target.value)} />
      {field.description ? <small>{field.description}</small> : null}
    </label>)}
  </div>;
}
