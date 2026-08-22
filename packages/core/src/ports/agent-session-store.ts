import { z } from "zod";

import type { AgentAdapter } from "../agent/adapter.js";
import type { AgentActivityReporter } from "../agent/activity.js";

export const agentSessionRecordSchema = z.object({
  agent: z.string().regex(/^[a-z][a-z0-9-]*$/),
  logicalSessionId: z.string().trim().min(1),
  issueId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  providerSessionId: z.string().trim().min(1).optional(),
  lifecycle: z.enum(["ACTIVE", "RETIRED"]),
  updatedAt: z.iso.datetime(),
}).strict();

export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>;

export interface AgentSessionStore {
  get(logicalSessionId: string): Promise<AgentSessionRecord | undefined>;
  save(record: AgentSessionRecord): Promise<void>;
}

export interface AgentPluginContext {
  sessions: AgentSessionStore;
  reportActivity?: AgentActivityReporter;
}

export interface AgentPlugin {
  readonly id: string;
  create(context: AgentPluginContext): AgentAdapter;
}
