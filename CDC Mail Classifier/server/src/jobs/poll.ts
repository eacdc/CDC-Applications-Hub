import cron from 'node-cron';
import { config } from '../config.js';
import { Inbox } from '../models/Inbox.js';
import { Email } from '../models/Email.js';
import { getGmailClient, fetchRecentMessageIds, fetchMessage } from '../lib/gmail.js';
import { normalizeGmailMessage } from '../lib/normalize.js';
import {
  classifyEmail,
  classificationToEmailFields,
} from '../lib/classifier.js';

let polling = false;

async function processInbox(inbox: InstanceType<typeof Inbox>): Promise<void> {
  if (!inbox.refreshToken) {
    console.warn(`[Poll] Inbox ${inbox.emailAddress} has no refresh token, skipping`);
    return;
  }

  const gmail = getGmailClient(inbox.refreshToken);
  const messageIds = await fetchRecentMessageIds(gmail, config.poll.lookbackMinutes);

  if (messageIds.length === 0) return;

  console.log(`[Poll] ${inbox.label} (${inbox.emailAddress}): ${messageIds.length} message(s)`);

  for (const messageId of messageIds) {
    try {
      const raw = await fetchMessage(gmail, messageId);
      const normalized = normalizeGmailMessage(raw, inbox.label ?? inbox.emailAddress ?? 'unknown');

      const existing = await Email.findOne({ messageId }).lean();
      const needsClassification =
        !existing ||
        !existing.classifier ||
        existing.confidence === undefined;

      let classificationFields: ReturnType<typeof classificationToEmailFields> | undefined;

      if (needsClassification) {
        const { result, modelUsed } = await classifyEmail(normalized);
        classificationFields = classificationToEmailFields(result, modelUsed);
      }

      const emailData = {
        messageId: normalized.messageId,
        threadId: normalized.threadId,
        inbox: normalized.inbox,
        fromName: normalized.fromName,
        fromEmail: normalized.fromEmail,
        toField: normalized.toField,
        ccField: normalized.ccField,
        subject: normalized.subject,
        sentDate: normalized.sentDate,
        gmailLink: normalized.gmailLink,
        body: normalized.body,
        attachments: normalized.attachments,
        ...(classificationFields ?? {}),
      };

      await Email.findOneAndUpdate(
        { messageId },
        { $set: emailData },
        { upsert: true, new: true },
      );
    } catch (err) {
      console.error(`[Poll] Failed to process message ${messageId} for ${inbox.emailAddress}`, err);
    }
  }
}

export async function runPollCycle(): Promise<void> {
  if (polling) {
    console.log('[Poll] Previous cycle still running, skipping');
    return;
  }

  polling = true;
  try {
    const inboxes = await Inbox.find({ active: true });
    for (const inbox of inboxes) {
      try {
        await processInbox(inbox);
      } catch (err) {
        console.error(`[Poll] Inbox ${inbox.emailAddress} failed`, err);
      }
    }
  } finally {
    polling = false;
  }
}

export function startPollJob(): void {
  cron.schedule(config.poll.cronExpression, () => {
    runPollCycle().catch((err) => {
      console.error('[Poll] Cron cycle error', err);
    });
  });
  console.log(`[Poll] Scheduled every minute (lookback ${config.poll.lookbackMinutes} min)`);
}
