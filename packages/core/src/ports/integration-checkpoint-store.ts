export interface IntegrationCheckpointStore {
  get(projectId: string, integration: string, key: string): string | undefined;
  save(
    projectId: string,
    integration: string,
    key: string,
    value: string | undefined,
  ): void;
}
