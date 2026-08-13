import type { gmail_v1 } from 'googleapis';
import { config } from '../config.js';
import { fetchMessage } from './gmail.js';
import { normalizeGmailMessage } from './normalize.js';
import type { NormalizedEmail, ThreadMessageContext } from '../types/index.js';

export async function fetchThreadMessagesForClassification(
  gmail: gmail_v1.Gmail,
  email: NormalizedEmail,
  inboxLabel: string,
): Promise<ThreadMessageContext[]> {
  if (!email.threadId) {
    return [toThreadContext(email, true)];
  }

  try {
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: email.threadId,
      format: 'full',
    });

    const rawMessages = res.data.messages ?? [];
    if (rawMessages.length === 0) {
      return [toThreadContext(email, true)];
    }

    const perMessageLimit = config.thread.messageBodyMaxLength;
    const normalized = rawMessages
      .map((msg) =>
        normalizeGmailMessage(msg, inboxLabel, {
          trimQuotes: true,
          bodyMaxLength: perMessageLimit,
        }),
      )
      .sort((a, b) => a.sentDate.getTime() - b.sentDate.getTime());

    const maxMessages = config.thread.maxMessages;
    const sliced =
      normalized.length > maxMessages
        ? normalized.slice(normalized.length - maxMessages)
        : normalized;

    return sliced.map((msg) => toThreadContext(msg, msg.messageId === email.messageId));
  } catch (err) {
    console.warn('[Thread] Failed to fetch thread, falling back to single message', {
      threadId: email.threadId,
      messageId: email.messageId,
      error: err,
    });
    return [toThreadContext(email, true)];
  }
}

/** Re-fetch the target message with full body limit for the latest message in prompts. */
export async function enrichLatestMessageBody(
  gmail: gmail_v1.Gmail,
  email: NormalizedEmail,
  inboxLabel: string,
  threadMessages: ThreadMessageContext[],
): Promise<ThreadMessageContext[]> {
  if (threadMessages.length === 0) {
    return threadMessages;
  }

  try {
    const raw = await fetchMessage(gmail, email.messageId);
    const latest = normalizeGmailMessage(raw, inboxLabel, {
      trimQuotes: true,
      bodyMaxLength: config.bodyMaxLength,
    });

    return threadMessages.map((msg) =>
      msg.messageId === email.messageId
        ? {
            ...msg,
            fromName: latest.fromName,
            fromEmail: latest.fromEmail,
            toField: latest.toField,
            ccField: latest.ccField,
            subject: latest.subject,
            sentDate: latest.sentDate,
            body: latest.body,
            attachments: latest.attachments,
            isLatest: true,
          }
        : msg,
    );
  } catch {
    return threadMessages;
  }
}

function toThreadContext(email: NormalizedEmail, isLatest: boolean): ThreadMessageContext {
  return {
    messageId: email.messageId,
    fromName: email.fromName,
    fromEmail: email.fromEmail,
    toField: email.toField,
    ccField: email.ccField,
    subject: email.subject,
    sentDate: email.sentDate,
    body: email.body,
    attachments: email.attachments,
    isLatest,
  };
}

/** Use an already-fetched latest message body in the thread prompt (avoids a second Gmail GET). */
export function applyLatestMessageToThread(
  email: NormalizedEmail,
  threadMessages: ThreadMessageContext[],
): ThreadMessageContext[] {
  if (threadMessages.length === 0) {
    return [toThreadContext(email, true)];
  }

  return threadMessages.map((msg) =>
    msg.messageId === email.messageId
      ? toThreadContext(email, true)
      : { ...msg, isLatest: false },
  );
}
