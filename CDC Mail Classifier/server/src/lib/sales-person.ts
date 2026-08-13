import { Inbox } from '../models/Inbox.js';
import { Email } from '../models/Email.js';
import { config } from '../config.js';
import {
  fetchSalesExecutiveNames,
  isSqlConfigured,
  lookupSalesPersonByClientDomain,
  lookupSalesPersonByConcernPersonEmail,
} from '../db-sql.js';
import type { ThreadMessageContext } from '../types/index.js';

/** Mail types eligible for sales-person tagging (all defined types except Other). */
export const SALES_TAG_MAIL_TYPES = new Set([
  'File received',
  'Correction received',
  'Approval received',
  'Production query',
  'Request for quote received',
]);

export type SalesPersonSource =
  | 'sales_executive_match'
  | 'concern_person_lookup'
  | 'client_lookup'
  | 'manual'
  | '';

export interface SalesPersonResult {
  salesPerson: string;
  salesPersonSource: SalesPersonSource;
}

interface Participant {
  name: string;
  email: string;
}

function parseAddressField(field: string): Participant[] {
  if (!field.trim()) return [];

  const results: Participant[] = [];
  const segments = field.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(?:"?([^"]*)"?\s)?<?([^>\s,]+@[^>\s,]+)>?$/);
    if (match) {
      results.push({
        name: (match[1] ?? '').trim(),
        email: match[2].trim().toLowerCase(),
      });
    } else if (trimmed.includes('@')) {
      results.push({ name: '', email: trimmed.toLowerCase() });
    }
  }

  return results;
}

function getMessageParticipants(msg: ThreadMessageContext): Participant[] {
  const participants: Participant[] = [];

  if (msg.fromEmail) {
    participants.push({
      name: msg.fromName,
      email: msg.fromEmail.toLowerCase(),
    });
  }

  participants.push(...parseAddressField(msg.toField));
  participants.push(...parseAddressField(msg.ccField));

  return participants;
}

function isCdcEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return config.cdcEmailDomains.some(
    (cdcDomain) => domain === cdcDomain || domain.endsWith(`.${cdcDomain}`),
  );
}

function domainTokenFromEmail(email: string): string | null {
  const host = email.split('@')[1]?.toLowerCase();
  if (!host) return null;
  const token = host.split('.')[0] ?? '';
  const cleaned = token.replace(/[^a-z0-9-]/gi, '');
  return cleaned.length >= 2 ? cleaned : null;
}

/** Split local part of CDC email into searchable name tokens (kaushik.bargi → kaushik, bargi). */
function localPartsFromCdcEmail(email: string): string[] {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return local
    .split(/[._-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

async function loadRegisteredInboxEmails(): Promise<Set<string>> {
  const inboxes = await Inbox.find().select('emailAddress').lean();
  const set = new Set<string>();
  for (const inbox of inboxes) {
    if (inbox.emailAddress) {
      set.add(inbox.emailAddress.toLowerCase());
    }
  }
  return set;
}

function collectCdcEmailsFromThread(
  threadMessages: ThreadMessageContext[],
  registeredInboxes: Set<string>,
): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const msg of threadMessages) {
    for (const participant of getMessageParticipants(msg)) {
      if (seen.has(participant.email)) continue;
      seen.add(participant.email);

      if (!isCdcEmail(participant.email)) continue;
      if (registeredInboxes.has(participant.email)) continue;

      emails.push(participant.email);
    }
  }

  return emails;
}

function scoreExecutiveAgainstParts(ledgerName: string, parts: string[]): number {
  const normalized = ledgerName.toLowerCase();
  let score = 0;

  for (const part of parts) {
    if (normalized.includes(part)) {
      score += part.length;
    }
  }

  return score;
}

function findBestSalesExecutiveMatch(
  cdcEmails: string[],
  executives: string[],
): string | null {
  const parts = new Set<string>();
  for (const email of cdcEmails) {
    for (const part of localPartsFromCdcEmail(email)) {
      parts.add(part);
    }
  }

  if (parts.size === 0 || executives.length === 0) {
    return null;
  }

  const partList = [...parts];
  let bestName: string | null = null;
  let bestScore = 0;

  for (const executive of executives) {
    const score = scoreExecutiveAgainstParts(executive, partList);
    if (score > bestScore) {
      bestScore = score;
      bestName = executive;
    }
  }

  return bestScore > 0 ? bestName : null;
}

function collectNonCdcEmailsFromThread(
  threadMessages: ThreadMessageContext[],
  registeredInboxes: Set<string>,
): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];

  for (let i = threadMessages.length - 1; i >= 0; i -= 1) {
    for (const participant of getMessageParticipants(threadMessages[i])) {
      if (seen.has(participant.email)) continue;
      seen.add(participant.email);

      if (isCdcEmail(participant.email)) continue;
      if (registeredInboxes.has(participant.email)) continue;

      emails.push(participant.email);
    }
  }

  return emails;
}

function findClientDomainToken(
  threadMessages: ThreadMessageContext[],
  registeredInboxes: Set<string>,
): string | null {
  const nonCdc = collectNonCdcEmailsFromThread(threadMessages, registeredInboxes);
  for (const email of nonCdc) {
    const token = domainTokenFromEmail(email);
    if (token) return token;
  }
  return null;
}

/**
 * If any email in the same Gmail thread was assigned a sales person manually,
 * return it for reuse on later messages when auto-resolution found no match.
 */
export async function getThreadManualSalesPerson(
  threadId: string | undefined,
  excludeMessageId?: string,
): Promise<SalesPersonResult | null> {
  const tid = threadId?.trim();
  if (!tid) return null;

  const filter: Record<string, unknown> = {
    threadId: tid,
    salesPersonSource: 'manual',
    salesPerson: { $exists: true, $nin: ['', null] },
  };
  if (excludeMessageId?.trim()) {
    filter.messageId = { $ne: excludeMessageId.trim() };
  }

  const prior = await Email.findOne(filter)
    .sort({ sentDate: -1, updatedAt: -1 })
    .select('salesPerson')
    .lean();

  const name = prior?.salesPerson?.trim();
  if (!name) return null;

  return { salesPerson: name, salesPersonSource: 'manual' };
}

export async function resolveSalesPerson(
  mailType: string | undefined,
  threadMessages: ThreadMessageContext[],
  options?: { threadId?: string; messageId?: string },
): Promise<SalesPersonResult> {
  const empty: SalesPersonResult = { salesPerson: '', salesPersonSource: '' };

  if (!mailType || !SALES_TAG_MAIL_TYPES.has(mailType) || threadMessages.length === 0) {
    return empty;
  }

  if (isSqlConfigured()) {
    const registeredInboxes = await loadRegisteredInboxEmails();
    const cdcEmails = collectCdcEmailsFromThread(threadMessages, registeredInboxes);

    if (cdcEmails.length > 0) {
      try {
        const executives = await fetchSalesExecutiveNames();
        const matched = findBestSalesExecutiveMatch(cdcEmails, executives);
        if (matched) {
          return { salesPerson: matched, salesPersonSource: 'sales_executive_match' };
        }
      } catch (err) {
        console.error('[SalesPerson] Sales executive match failed', { cdcEmails, error: err });
      }
    }

    const nonCdcEmails = collectNonCdcEmailsFromThread(threadMessages, registeredInboxes);
    for (const email of nonCdcEmails) {
      try {
        const fromConcern = await lookupSalesPersonByConcernPersonEmail(email);
        if (fromConcern) {
          return { salesPerson: fromConcern, salesPersonSource: 'concern_person_lookup' };
        }
      } catch (err) {
        console.error('[SalesPerson] ConcernPerson lookup failed', { email, error: err });
      }
    }

    const domainToken = findClientDomainToken(threadMessages, registeredInboxes);
    if (domainToken) {
      try {
        const fromDb = await lookupSalesPersonByClientDomain(domainToken);
        if (fromDb) {
          return { salesPerson: fromDb, salesPersonSource: 'client_lookup' };
        }
      } catch (err) {
        console.error('[SalesPerson] Client lookup failed', { domainToken, error: err });
      }
    }
  }

  const threadManual = await getThreadManualSalesPerson(
    options?.threadId,
    options?.messageId,
  );
  if (threadManual) {
    return threadManual;
  }

  return empty;
}
