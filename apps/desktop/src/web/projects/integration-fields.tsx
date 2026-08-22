import type { ConfigValue, IntegrationPluginManifest } from "../api/types.js";

import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Input } from "../components/ui/input.js";

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
    {manifest.configFields.map((field) => {
      const description = field.description ? `${manifest.id}-${field.key}-description` : undefined;
      if (field.type === "boolean") {
        return <label className="switch-row" key={field.key}>
          <Checkbox aria-describedby={description} checked={Boolean(config[field.key] ?? field.defaultValue ?? false)} onCheckedChange={(checked) => onConfigChange(field.key, Boolean(checked))} />
          {field.label}
          {field.description ? <small id={description}>{field.description}</small> : null}
        </label>;
      }
      if (field.type === "number") {
        return <label key={field.key}>{field.label}
          <Input aria-describedby={description} required={field.required} type="number" value={Number(config[field.key] ?? field.defaultValue ?? 0)} onChange={(event) => onConfigChange(field.key, Number(event.target.value))} />
          {field.description ? <small id={description}>{field.description}</small> : null}
        </label>;
      }
      if (field.type === "string[]") {
        const values = config[field.key] as string[] | undefined ?? field.defaultValue ?? [];
        return <fieldset className="field-wide" key={field.key}>
          <legend>{field.label}</legend>
          {values.map((value, index) => <div className="credential-row" key={`${field.key}-${index}`}>
            <Input aria-label={`${field.label} ${index + 1}`} required={field.required} value={value} onChange={(event) => onConfigChange(field.key, values.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry))} />
            <Button aria-label={`删除 ${field.label} ${index + 1}`} size="sm" type="button" variant="outline" onClick={() => onConfigChange(field.key, values.filter((_entry, entryIndex) => entryIndex !== index))}>删除</Button>
          </div>)}
          <Button size="sm" type="button" variant="outline" onClick={() => onConfigChange(field.key, [...values, ""])}>添加{field.label}</Button>
          {field.description ? <small id={description}>{field.description}</small> : null}
        </fieldset>;
      }
      return <label key={field.key}>{field.label}
        <Input aria-describedby={description} required={field.required} value={String(config[field.key] ?? field.defaultValue ?? "")} onChange={(event) => onConfigChange(field.key, event.target.value)} />
        {field.description ? <small id={description}>{field.description}</small> : null}
      </label>;
    })}
    {manifest.secretFields.map((field) => <label key={field.key}>{field.label}
      <Input autoComplete="off" placeholder={secretConfigured[field.key] ? "已配置；输入新值可替换" : undefined} required={field.required && !secretConfigured[field.key]} type="password" value={secretValues[field.key] ?? ""} onChange={(event) => onSecretChange(field.key, event.target.value)} />
      {field.description ? <small>{field.description}</small> : null}
    </label>)}
  </div>;
}
