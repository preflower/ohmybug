import type { Issue } from "../issue/types.js";
import type {
  AgentSessionRef,
  Assessment,
  Delivery,
  RepairResult,
} from "./types.js";

export interface ProjectCommands {
  install?: string;
  test?: string;
  start?: string;
  acceptanceUrl?: string;
}

export interface ProjectContext {
  id: string;
  path: string;
  instructions?: string;
  commands?: ProjectCommands;
}

export interface CreateSessionInput {
  issue: Issue;
  project: ProjectContext;
}

export interface AssessInput {
  issue: Issue;
  project: ProjectContext;
  feedback?: string;
}

export interface RepairInput {
  issue: Issue;
  project: ProjectContext;
  assessment: Assessment;
  evidenceDirectory: string;
  previousDelivery?: Delivery;
  feedback?: string;
}

export interface AgentAdapter {
  createSession(input: CreateSessionInput): Promise<AgentSessionRef>;
  assess(
    session: AgentSessionRef,
    input: AssessInput,
  ): Promise<Assessment>;
  repair(session: AgentSessionRef, input: RepairInput): Promise<RepairResult>;
  cancel(session: AgentSessionRef): Promise<void>;
}
