export type AgentActivityStage =
  | "ASSESSMENT"
  | "REPAIR"
  | "EVIDENCE"
  | "FINALIZATION_RECOVERY";
export type AgentActivityLevel = "info" | "error";

export interface AgentActivityUpdate {
  sessionId: string;
  stage: AgentActivityStage;
  type: string;
  message: string;
  detail?: string;
  correlationId?: string;
  level: AgentActivityLevel;
}

export type AgentActivityReporter = (
  activity: AgentActivityUpdate,
) => void | Promise<void>;
