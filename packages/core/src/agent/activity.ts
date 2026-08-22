export type AgentActivityStage = "ASSESSMENT" | "REPAIR" | "EVIDENCE";
export type AgentActivityLevel = "info" | "error";

export interface AgentActivityUpdate {
  sessionId: string;
  stage: AgentActivityStage;
  type: string;
  message: string;
  detail?: string;
  level: AgentActivityLevel;
}

export type AgentActivityReporter = (
  activity: AgentActivityUpdate,
) => void | Promise<void>;
