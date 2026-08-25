import type { ConfigValue, IntegrationPluginManifest } from "../api/types.js";

import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { ConfigFields } from "./config-fields.js";

interface IntegrationFieldsProps {
  manifest: IntegrationPluginManifest;
  config: Record<string, ConfigValue>;
  secretConfigured: Record<string, boolean>;
  secretValues: Record<string, string>;
  editingSecrets: Record<string, boolean>;
  onConfigChange(key: string, value: ConfigValue): void;
  onEditSecret(key: string, editing: boolean): void;
  onSecretChange(key: string, value: string): void;
}

export function IntegrationFields({
  manifest,
  config,
  secretConfigured,
  secretValues,
  editingSecrets,
  onConfigChange,
  onEditSecret,
  onSecretChange,
}: IntegrationFieldsProps) {
  if (!manifest.sections?.length) {
    return <div className="form-grid integration-fields-legacy">
      <ConfigFields fields={manifest.configFields} config={config} idPrefix={manifest.id} onChange={onConfigChange} />
      {manifest.secretFields.map((field) => <SecretField
        configured={Boolean(secretConfigured[field.key])}
        editing={Boolean(editingSecrets[field.key])}
        field={field}
        key={field.key}
        value={secretValues[field.key] ?? ""}
        onEdit={onEditSecret}
        onChange={onSecretChange}
      />)}
    </div>;
  }

  return <div className="integration-sections">
    {manifest.sections.map((section) => {
      const configFields = manifest.configFields.filter((field) => field.section === section.id);
      const secretFields = manifest.secretFields.filter((field) => field.section === section.id);
      const content = <div className="form-grid integration-section-fields">
        <ConfigFields fields={configFields} config={config} idPrefix={`${manifest.id}-${section.id}`} onChange={onConfigChange} />
        {secretFields.map((field) => <SecretField
          configured={Boolean(secretConfigured[field.key])}
          editing={Boolean(editingSecrets[field.key])}
          field={field}
          key={field.key}
          value={secretValues[field.key] ?? ""}
          onEdit={onEditSecret}
          onChange={onSecretChange}
        />)}
      </div>;

      return section.collapsed
        ? <details className="integration-section integration-section-collapsed" key={section.id}>
            <summary><div><h3>{section.label}</h3>{section.description ? <p>{section.description}</p> : null}</div></summary>
            {content}
          </details>
        : <section className="integration-section" key={section.id}>
            <header><h3>{section.label}</h3>{section.description ? <p>{section.description}</p> : null}</header>
            {content}
          </section>;
    })}
  </div>;
}

type SecretFieldDefinition = IntegrationPluginManifest["secretFields"][number];

function SecretField({
  field,
  configured,
  editing,
  value,
  onEdit,
  onChange,
}: {
  field: SecretFieldDefinition;
  configured: boolean;
  editing: boolean;
  value: string;
  onEdit(key: string, editing: boolean): void;
  onChange(key: string, value: string): void;
}) {
  if (configured && !editing) {
    return <div className="secret-field" data-secret-key={field.key}>
      <span className="secret-field-label">{field.label}</span>
      <span className="secret-configured">已配置</span>
      <Button aria-label={`替换 ${field.label}`} size="sm" type="button" variant="outline" onClick={() => onEdit(field.key, true)}>替换</Button>
      {field.description ? <small>{field.description}</small> : null}
    </div>;
  }

  return <label className="secret-field secret-field-editing" data-secret-key={field.key}>{field.label}
    <Input
      aria-label={field.label}
      autoComplete="off"
      placeholder={field.placeholder}
      required={field.required && !configured}
      type="password"
      value={value}
      onChange={(event) => onChange(field.key, event.target.value)}
    />
    {configured ? <Button aria-label={`取消替换 ${field.label}`} size="sm" type="button" variant="ghost" onClick={() => {
      onChange(field.key, "");
      onEdit(field.key, false);
    }}>取消替换</Button> : null}
    {field.description ? <small>{field.description}</small> : null}
  </label>;
}
