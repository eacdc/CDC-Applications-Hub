import crypto from 'node:crypto';
import OpenAI from 'openai';
import { config } from '../config.js';
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_USER_PROMPT,
} from '../prompts/classifier.js';
import { saveAgentStep, markStepAsFinal, type AgentStepInput } from './agent-log.js';
import type { AgentStepReason, AgentStepTrigger } from '../models/ClassificationStepLog.js';
import type {
  ClassificationResult,
  NormalizedEmail,
  ThreadMessageContext,
} from '../types/index.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export interface ClassifyOptions {
  trigger?: AgentStepTrigger;
  threadMessages?: ThreadMessageContext[];
}

export interface ClassifyOutput {
  result: ClassificationResult;
  modelUsed: string;
}

const EMPTY_CLASSIFICATION: ClassificationResult = {
  department: '',
  mail_type: '',
  confidence: 0,
  job_number: '',
  client_name: '',
  isbn: '',
  title: '',
  quantity: '',
  due_date: '',
  summary: '',
  action_required: '',
  type_specific: {},
};

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('overloaded')
  );
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isTransientError(err)) {
        const delay = attempt * 1500;
        console.warn(`[OpenAI] ${label} attempt ${attempt} failed, retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function parseClassification(raw: string): ClassificationResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ClassificationResult>;
    return {
      department: parsed.department ?? '',
      mail_type: parsed.mail_type ?? '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      job_number: parsed.job_number ?? '',
      client_name: parsed.client_name ?? '',
      isbn: parsed.isbn ?? '',
      title: parsed.title ?? '',
      quantity: parsed.quantity ?? '',
      due_date: parsed.due_date ?? '',
      summary: parsed.summary ?? '',
      action_required: parsed.action_required ?? '',
      type_specific:
        parsed.type_specific && typeof parsed.type_specific === 'object'
          ? (parsed.type_specific as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

function toPromptMessages(threadMessages: ThreadMessageContext[]) {
  return threadMessages.map((msg) => ({
    fromName: msg.fromName,
    fromEmail: msg.fromEmail,
    toField: msg.toField,
    ccField: msg.ccField,
    subject: msg.subject,
    sentDate: msg.sentDate.toISOString(),
    body: msg.body,
    attachments: msg.attachments,
    isLatest: msg.isLatest,
  }));
}

function buildAgentInput(
  email: NormalizedEmail,
  threadMessages: ThreadMessageContext[],
): AgentStepInput {
  const messages =
    threadMessages.length > 0
      ? threadMessages
      : [
          {
            messageId: email.messageId,
            fromName: email.fromName,
            fromEmail: email.fromEmail,
            toField: email.toField,
            ccField: email.ccField,
            subject: email.subject,
            sentDate: email.sentDate,
            body: email.body,
            attachments: email.attachments,
            isLatest: true,
          },
        ];

  return {
    systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
    userPrompt: CLASSIFIER_USER_PROMPT(toPromptMessages(messages)),
  };
}

function buildEmailMeta(email: NormalizedEmail) {
  return {
    fromName: email.fromName,
    fromEmail: email.fromEmail,
    toField: email.toField,
    ccField: email.ccField,
    subject: email.subject,
    threadId: email.threadId,
  };
}

interface AgentStepResult {
  raw: string;
  result: ClassificationResult | null;
  error?: string;
}

async function runAgentStep(
  email: NormalizedEmail,
  threadMessages: ThreadMessageContext[],
  model: string,
  runId: string,
  step: number,
  trigger: AgentStepTrigger,
  reason: AgentStepReason,
  selectedAsFinal: boolean,
): Promise<AgentStepResult> {
  const input = buildAgentInput(email, threadMessages);
  let raw = '';
  let error: string | undefined;

  try {
    const response = await withRetry(
      () =>
        openai.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userPrompt },
          ],
        }),
      `chat.completions(${model})`,
    );
    raw = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const result = raw ? parseClassification(raw) : null;

  await saveAgentStep({
    messageId: email.messageId,
    runId,
    step,
    trigger,
    reason,
    model,
    input,
    output: {
      raw,
      parsed: result,
      parseSuccess: result !== null,
      error,
    },
    emailMeta: buildEmailMeta(email),
    selectedAsFinal,
  });

  return { raw, result, error };
}

export async function classifyEmail(
  email: NormalizedEmail,
  options: ClassifyOptions = {},
): Promise<ClassifyOutput> {
  const trigger = options.trigger ?? 'poll';
  const threadMessages = options.threadMessages ?? [];
  const runId = crypto.randomUUID();
  let step = 1;
  let modelUsed: string = config.models.cheap;

  const cheapStep = await runAgentStep(
    email,
    threadMessages,
    config.models.cheap,
    runId,
    step,
    trigger,
    'initial',
    false,
  );

  let result = cheapStep.result;

  if (cheapStep.error) {
    console.error('[Classifier] Cheap model failed, escalating', cheapStep.error);
    step += 1;
    modelUsed = config.models.strong;
    const strongStep = await runAgentStep(
      email,
      threadMessages,
      config.models.strong,
      runId,
      step,
      trigger,
      'escalation_cheap_error',
      true,
    );
    result = strongStep.result;
    if (!result) {
      return { result: { ...EMPTY_CLASSIFICATION, confidence: 0 }, modelUsed };
    }
    return { result, modelUsed };
  }

  const needsEscalation =
    !result || result.confidence < config.poll.confidenceEscalationThreshold;

  if (!needsEscalation && result) {
    await markStepAsFinal(email.messageId, runId, 1);
    return { result, modelUsed };
  }

  if (needsEscalation) {
    step += 1;
    modelUsed = config.models.strong;
    const escalationReason: AgentStepReason = result ? 'escalation_low_confidence' : 'escalation_parse_failure';
    const strongStep = await runAgentStep(
      email,
      threadMessages,
      config.models.strong,
      runId,
      step,
      trigger,
      escalationReason,
      true,
    );
    result = strongStep.result;

    if (!result) {
      if (strongStep.error) {
        console.error('[Classifier] Strong model also failed', strongStep.error);
      }
      return { result: { ...EMPTY_CLASSIFICATION, confidence: 0 }, modelUsed };
    }
    return { result, modelUsed };
  }

  if (!result) {
    return { result: { ...EMPTY_CLASSIFICATION, confidence: 0 }, modelUsed };
  }

  return { result, modelUsed };
}

export function classificationToEmailFields(
  classification: ClassificationResult,
  modelUsed: string,
): {
  department: string;
  mailType: string;
  confidence: number;
  needsReview: boolean;
  classifier: string;
  jobNumber: string;
  clientName: string;
  isbn: string;
  title: string;
  quantity: string;
  dueDate: string;
  summary: string;
  actionRequired: string;
  typeSpecific: Record<string, unknown>;
} {
  const confidence = classification.confidence;
  return {
    department: classification.department,
    mailType: classification.mail_type,
    confidence,
    needsReview: confidence < config.poll.reviewThreshold,
    classifier: modelUsed,
    jobNumber: classification.job_number,
    clientName: classification.client_name,
    isbn: classification.isbn,
    title: classification.title,
    quantity: classification.quantity,
    dueDate: classification.due_date,
    summary: classification.summary,
    actionRequired: classification.action_required,
    typeSpecific: classification.type_specific,
  };
}
