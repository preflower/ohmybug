import type {
  Assessment,
  IntegrationInput,
  Issue,
  RuntimeProject,
} from "@oh-my-bug/core";

import type { BranchInfo } from "./workspace.js";

export interface LifecycleEventMap {
  "issue.beforeCreate": {
    issue: Issue;
    project: RuntimeProject;
    input: IntegrationInput;
  };
  "issue.created": { issue: Issue; project: RuntimeProject };
  "assessment.before": { issue: Issue; project: RuntimeProject };
  "assessment.after": {
    issue: Issue;
    project: RuntimeProject;
    assessment?: Assessment;
  };
  "repair.before": { issue: Issue; project: RuntimeProject };
  "repair.after": { issue: Issue; project: RuntimeProject };
  "issue.userApproved": { issue: Issue; project: RuntimeProject };
  "issue.completed": {
    issue: Issue;
    project: RuntimeProject;
    branch?: BranchInfo;
  };
}

export type LifecycleListener<K extends keyof LifecycleEventMap> = (
  payload: Readonly<LifecycleEventMap[K]>,
) => void;

export interface LifecycleHooks {
  on<K extends keyof LifecycleEventMap>(
    owner: string,
    name: K,
    listener: LifecycleListener<K>,
  ): () => void;
  emit<K extends keyof LifecycleEventMap>(
    name: K,
    payload: LifecycleEventMap[K],
  ): void;
}
