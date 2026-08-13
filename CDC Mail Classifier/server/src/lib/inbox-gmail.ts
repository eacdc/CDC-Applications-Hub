import { Inbox } from '../models/Inbox.js';
import { getGmailClient } from './gmail.js';
import type { gmail_v1 } from 'googleapis';

export async function resolveGmailClientForInboxLabel(
  inboxLabel: string,
): Promise<{ gmail: gmail_v1.Gmail; label: string } | null> {
  const inbox = await Inbox.findOne({
    active: true,
    refreshToken: { $exists: true, $nin: [null, ''] },
    $or: [{ label: inboxLabel }, { emailAddress: inboxLabel }],
  });

  if (!inbox?.refreshToken) {
    return null;
  }

  return {
    gmail: getGmailClient(inbox.refreshToken),
    label: inbox.label ?? inbox.emailAddress ?? inboxLabel,
  };
}
