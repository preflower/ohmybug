import type {
  ConfigValue,
  IntegrationConnectionTestResult,
  IntegrationPluginManifest,
} from "../api/types.js";

import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { ConfigFields } from "./config-fields.js";
import { IntegrationConnectionTest } from "./integration-connection-test.js";

interface IntegrationFieldsProps {
  manifest: IntegrationPluginManifest;
  config: Record<string, ConfigValue>;
  secretConfigured: Record<string, boolean>;
  secretValues: Record<string, string>;
  editingSecrets: Record<string, boolean>;
  projectId?: string;
  dirty?: boolean;
  onConfigChange(key: string, value: ConfigValue): void;
  onEditSecret(key: string, editing: boolean): void;
  onSecretChange(key: string, value: string): void;
  onTestSavedIntegration?(
    projectId: string,
    integrationId: string,
  ): Promise<IntegrationConnectionTestResult>;
}

export function IntegrationFields({
  manifest,
  config,
  secretConfigured,
  secretValues,
  editingSecrets,
  projectId,
  dirty = false,
  onConfigChange,
  onEditSecret,
  onSecretChange,
  onTestSavedIntegration = unsupportedConnectionTest,
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
      const summary = section.summary ? sectionSummary(section.summary, config) : undefined;
      const content = configFields.length > 0 || secretFields.length > 0
        ? <div className="form-grid integration-section-fields">
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
      </div>
        : null;
      const connectionTest = section.connectionTest ? <IntegrationConnectionTest
        dirty={dirty}
        integrationId={manifest.id}
        projectId={projectId}
        onTest={onTestSavedIntegration}
      /> : null;

      return section.collapsed
        ? <details className="integration-section integration-section-collapsed" key={section.id}>
            <summary>
              <div><h3>{section.label}</h3>{section.description ? <p>{section.description}</p> : null}</div>
              {summary ? <strong className="integration-section-collapsed-summary">{summary}</strong> : null}
            </summary>
            {connectionTest}
            {content}
          </details>
        : <section className="integration-section" data-integration-section={section.id} key={section.id}>
            <header><h3>{section.label}</h3>{section.description ? <p>{section.description}</p> : null}</header>
            {section.summary && summary ? <div className="integration-section-summary">
              {"label" in section.summary ? <span>{section.summary.label}</span> : null}
              <strong><i aria-hidden="true" />{summary}</strong>
            </div> : null}
            {connectionTest}
            {content}
          </section>;
    })}
  </div>;
}

type IntegrationSection = NonNullable<IntegrationPluginManifest["sections"]>[number];

function sectionSummary(
  summary: NonNullable<IntegrationSection["summary"]>,
  config: Record<string, ConfigValue>,
): string {
  if ("value" in summary) return summary.value;
  return summary.fields.map((field) => {
    const value = String(config[field.key] ?? "").trim();
    return value ? `${field.valuePrefix ?? ""}${value}` : field.emptyValue;
  }).join(summary.separator ?? " · ");
}

function unsupportedConnectionTest(): Promise<never> {
  return Promise.reject(new Error("INTEGRATION_CONNECTION_TEST_UNSUPPORTED"));
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
