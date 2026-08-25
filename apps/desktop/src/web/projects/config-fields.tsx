import type {
  ConfigValue,
  WorkspaceProviderInspection,
  WorkspaceProviderManifest,
} from "../api/types.js";
import { Trash2 } from "lucide-react";

import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Input } from "../components/ui/input.js";
import { isConfigFieldVisible } from "./config-field-visibility.js";

interface ConfigFieldsProps {
  fields: WorkspaceProviderManifest["configFields"];
  config: Record<string, ConfigValue>;
  idPrefix?: string;
  inspection?: WorkspaceProviderInspection;
  onChange(key: string, value: ConfigValue): void;
}

export function ConfigFields({ fields, config, idPrefix = "config", inspection, onChange }: ConfigFieldsProps) {
  return <>{fields.filter((field) => isConfigFieldVisible(field, fields, config)).map((field) => {
    const description = field.description ? `${idPrefix}-${field.key}-description` : undefined;
    const state = inspection?.fields?.[field.key];
    const stateReason = state?.reason ? `${idPrefix}-${field.key}-availability` : undefined;
    const describedBy = [description, stateReason].filter(Boolean).join(" ") || undefined;
    if (field.type === "boolean") {
      return <div className="switch-field" data-config-key={field.key} key={field.key}>
        <label className="switch-row"><Checkbox aria-describedby={describedBy} checked={Boolean(config[field.key] ?? field.defaultValue ?? false)} disabled={state ? !state.enabled : false} onCheckedChange={(checked) => onChange(field.key, Boolean(checked))} />{field.label}</label>
        {field.description ? <small id={description}>{field.description}</small> : null}
        {state?.reason ? <small id={stateReason}>{state.reason}</small> : null}
      </div>;
    }
    if (field.type === "number") {
      return <label data-config-key={field.key} key={field.key}>{field.label}
        <Input aria-describedby={description} required={field.required} type="number" value={Number(config[field.key] ?? field.defaultValue ?? 0)} onChange={(event) => onChange(field.key, Number(event.target.value))} />
        {field.description ? <small id={description}>{field.description}</small> : null}
      </label>;
    }
    if (field.type === "string[]") {
      const values = config[field.key] as string[] | undefined ?? field.defaultValue ?? [];
      return <fieldset className="field-wide" data-config-key={field.key} key={field.key}>
        <legend>{field.label}</legend>
        {values.map((value, index) => <div className="credential-row" key={`${field.key}-${index}`}>
          <Input aria-label={`${field.label} ${index + 1}`} required={field.required} value={value} onChange={(event) => onChange(field.key, values.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry))} />
          <Button aria-label={`删除 ${field.label} ${index + 1}`} size="sm" type="button" variant="outline" onClick={() => onChange(field.key, values.filter((_entry, entryIndex) => entryIndex !== index))}><Trash2 aria-hidden="true" /></Button>
        </div>)}
        <Button size="sm" type="button" variant="outline" onClick={(event) => {
          const fieldset = event.currentTarget.closest("fieldset");
          onChange(field.key, [...values, ""]);
          setTimeout(() => {
            const inputs = fieldset?.querySelectorAll<HTMLInputElement>("input");
            inputs?.item(inputs.length - 1).focus();
          }, 0);
        }}>{field.addLabel ?? `添加${field.label}`}</Button>
        {field.description ? <small id={description}>{field.description}</small> : null}
      </fieldset>;
    }
    return <label data-config-key={field.key} key={field.key}>{field.label}
      <Input aria-describedby={description} required={field.required} value={String(config[field.key] ?? field.defaultValue ?? "")} onChange={(event) => onChange(field.key, event.target.value)} />
      {field.description ? <small id={description}>{field.description}</small> : null}
    </label>;
  })}{inspection?.properties?.length ? <dl className="workspace-inspection-properties">
    {inspection.properties.map((property) => <div key={property.key}>
      <dt>{property.label}</dt>
      <dd><code>{property.value}</code>{property.description ? <small>{property.description}</small> : null}</dd>
    </div>)}
  </dl> : null}</>;
}
