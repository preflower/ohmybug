import { randomUUID } from "node:crypto";

import {
  integrationInputSchema,
  type IntegrationAdapter,
  type IntegrationInput,
} from "@oh-my-bug/core";

export interface ManualRawData {
  commandId: string;
  content: string;
  summary?: string;
  context?: Record<string, unknown>;
}

export interface ManualAdapterOptions {
  id?: () => string;
  now?: () => Date;
}

export class ManualIntegrationAdapter
implements IntegrationAdapter<ManualRawData> {
  readonly name = "manual";
  private readonly id: () => string;
  private readonly now: () => Date;

  constructor(options: ManualAdapterOptions = {}) {
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async adapt(
    rawData: ManualRawData,
  ): Promise<IntegrationInput<ManualRawData>> {
    const commandId = rawData.commandId.trim();
    const content = rawData.content.trim();
    if (!commandId) throw new Error("MANUAL_COMMAND_ID_REQUIRED");
    if (!content) throw new Error("MANUAL_CONTENT_REQUIRED");

    return integrationInputSchema.parse({
      id: this.id(),
      integration: this.name,
      inputKey: commandId,
      rawData,
      data: {
        content,
        ...(rawData.summary?.trim()
          ? { summary: rawData.summary.trim() }
          : {}),
        ...(rawData.context ? { context: rawData.context } : {}),
      },
      receivedAt: this.now().toISOString(),
    }) as IntegrationInput<ManualRawData>;
  }
}
