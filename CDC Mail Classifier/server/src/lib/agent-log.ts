import {
  ClassificationStepLog,
  type AgentStepReason,
  type AgentStepTrigger,
} from '../models/ClassificationStepLog.js';
import type { ClassificationResult } from '../types/index.js';

export interface AgentStepInput {
  systemPrompt: string;
  userPrompt: string;
}

export interface AgentStepOutput {
  raw: string;
  parsed: ClassificationResult | null;
  parseSuccess: boolean;
  error?: string;
}

export interface AgentStepEmailMeta {
  fromName: string;
  fromEmail: string;
  toField: string;
  ccField: string;
  subject: string;
  threadId: string;
}

export interface SaveAgentStepParams {
  messageId: string;
  runId: string;
  step: number;
  trigger: AgentStepTrigger;
  reason: AgentStepReason;
  model: string;
  input: AgentStepInput;
  output: AgentStepOutput;
  emailMeta: AgentStepEmailMeta;
  selectedAsFinal?: boolean;
}

export async function markStepAsFinal(
  messageId: string,
  runId: string,
  step: number,
): Promise<void> {
  try {
    await ClassificationStepLog.updateOne(
      { messageId, runId, step },
      { $set: { selectedAsFinal: true } },
    );
  } catch (err) {
    console.error('[AgentLog] Failed to mark step as final', { messageId, runId, step, error: err });
  }
}

export async function saveAgentStep(params: SaveAgentStepParams): Promise<void> {
  try {
    await ClassificationStepLog.create({
      messageId: params.messageId,
      runId: params.runId,
      step: params.step,
      trigger: params.trigger,
      reason: params.reason,
      model: params.model,
      input: params.input,
      output: {
        raw: params.output.raw,
        parsed: params.output.parsed,
        parseSuccess: params.output.parseSuccess,
        error: params.output.error ?? '',
      },
      selectedAsFinal: params.selectedAsFinal ?? false,
      emailMeta: params.emailMeta,
    });
  } catch (err) {
    console.error('[AgentLog] Failed to save classification step', {
      messageId: params.messageId,
      runId: params.runId,
      step: params.step,
      error: err,
    });
  }
}
