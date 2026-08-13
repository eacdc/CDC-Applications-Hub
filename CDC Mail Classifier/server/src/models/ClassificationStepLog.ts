import mongoose from 'mongoose';
import { config } from '../config.js';

export type AgentStepTrigger = 'poll' | 'reclassify';

export type AgentStepReason =
  | 'initial'
  | 'escalation_cheap_error'
  | 'escalation_parse_failure'
  | 'escalation_low_confidence';

const ClassificationStepLogSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, index: true },
    step: { type: Number, required: true },
    trigger: { type: String, enum: ['poll', 'reclassify'], required: true },
    reason: {
      type: String,
      enum: [
        'initial',
        'escalation_cheap_error',
        'escalation_parse_failure',
        'escalation_low_confidence',
      ],
      required: true,
    },
    model: { type: String, required: true },
    input: {
      systemPrompt: { type: String, required: true },
      userPrompt: { type: String, required: true },
    },
    output: {
      raw: { type: String, default: '' },
      parsed: { type: mongoose.Schema.Types.Mixed, default: null },
      parseSuccess: { type: Boolean, default: false },
      error: { type: String, default: '' },
    },
    selectedAsFinal: { type: Boolean, default: false },
    runId: { type: String, required: true, index: true },
    emailMeta: {
      fromName: { type: String, default: '' },
      fromEmail: { type: String, default: '' },
      toField: { type: String, default: '' },
      ccField: { type: String, default: '' },
      subject: { type: String, default: '' },
      threadId: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

ClassificationStepLogSchema.index({ messageId: 1, runId: 1, step: 1 });
ClassificationStepLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: config.agentLogRetentionDays * 24 * 60 * 60 },
);

export type ClassificationStepLogDocument = mongoose.InferSchemaType<
  typeof ClassificationStepLogSchema
> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const ClassificationStepLog = mongoose.model(
  'ClassificationStepLog',
  ClassificationStepLogSchema,
);
