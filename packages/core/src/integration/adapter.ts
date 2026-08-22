import type { IntegrationInput } from "./input.js";

export interface IntegrationAdapter<RawData = unknown> {
  readonly name: string;
  adapt(rawData: RawData): Promise<IntegrationInput<RawData>>;
}
