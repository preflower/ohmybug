import type { ConfigValue, WorkspaceProviderManifest } from "../api/types.js";

import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Input } from "../components/ui/input.js";

interface ConfigFieldsProps {
  fields: WorkspaceProviderManifest["configFields"];
  config: Record<string, ConfigValue>;
  idPrefix?: string;
  onChange(key: string, value: ConfigValue): void;
}

export function ConfigFields({ fields, config, idPrefix = "config", onChange }: ConfigFieldsProps) {
  return <>{fields.map((field) => {
    const description = field.description ? `${idPrefix}-${field.key}-description` : undefined;
    if (field.type === "boolean") {
      return <label className="switch-row" key={field.key}>
        <Checkbox aria-describedby={description} checked={Boolean(config[field.key] ?? field.defaultValue ?? false)} onCheckedChange={(checked) => onChange(field.key, Boolean(checked))} />
        {field.label}
        {field.description ? <small id={description}>{field.description}</small> : null}
      </label>;
    }
    if (field.type === "number") {
      return <label key={field.key}>{field.label}
        <Input aria-describedby={description} required={field.required} type="number" value={Number(config[field.key] ?? field.defaultValue ?? 0)} onChange={(event) => onChange(field.key, Number(event.target.value))} />
        {field.description ? <small id={description}>{field.description}</small> : null}
      </label>;
    }
    if (field.type === "string[]") {
      const values = config[field.key] as string[] | undefined ?? field.defaultValue ?? [];
      return <fieldset className="field-wide" key={field.key}>
        <legend>{field.label}</legend>
        {values.map((value, index) => <div className="credential-row" key={`${field.key}-${index}`}>
          <Input aria-label={`${field.label} ${index + 1}`} required={field.required} value={value} onChange={(event) => onChange(field.key, values.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry))} />
          <Button aria-label={`删除 ${field.label} ${index + 1}`} size="sm" type="button" variant="outline" onClick={() => onChange(field.key, values.filter((_entry, entryIndex) => entryIndex !== index))}>删除</Button>
        </div>)}
        <Button size="sm" type="button" variant="outline" onClick={() => onChange(field.key, [...values, ""])}>添加{field.label}</Button>
        {field.description ? <small id={description}>{field.description}</small> : null}
      </fieldset>;
    }
    return <label key={field.key}>{field.label}
      <Input aria-describedby={description} required={field.required} value={String(config[field.key] ?? field.defaultValue ?? "")} onChange={(event) => onChange(field.key, event.target.value)} />
      {field.description ? <small id={description}>{field.description}</small> : null}
    </label>;
  })}</>;
}
