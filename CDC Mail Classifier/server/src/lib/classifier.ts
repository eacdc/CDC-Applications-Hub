import OpenAI from 'openai';
import { config } from '../config.js';
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_USER_PROMPT,
} from '../prompts/classifier.js';
import type { ClassificationResult, NormalizedEmail } from '../types/index.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

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

async function callModel(model: string, email: NormalizedEmail): Promise<string> {
  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: CLASSIFIER_USER_PROMPT({
              fromName: email.fromName,
              fromEmail: email.fromEmail,
              toField: email.toField,
              ccField: email.ccField,
              subject: email.subject,
              sentDate: email.sentDate.toISOString(),
              body: email.body,
              attachments: email.attachments,
            }),
          },
        ],
        temperature: 0.1,
      }),
    `chat.completions(${model})`,
  );

  return response.choices[0]?.message?.content ?? '';
}

export async function classifyEmail(email: NormalizedEmail): Promise<ClassifyOutput> {
  let modelUsed: string = config.models.cheap;
  let raw = '';

  try {
    raw = await callModel(config.models.cheap, email);
  } catch (err) {
    console.error('[Classifier] Cheap model failed, escalating', err);
    modelUsed = config.models.strong;
    raw = await callModel(config.models.strong, email);
  }

  let result = parseClassification(raw);

  const needsEscalation =
    !result ||
    result.confidence < config.poll.confidenceEscalationThreshold;

  if (needsEscalation && modelUsed === config.models.cheap) {
    try {
      modelUsed = config.models.strong;
      raw = await callModel(config.models.strong, email);
      result = parseClassification(raw);
    } catch (err) {
      console.error('[Classifier] Strong model also failed', err);
    }
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
