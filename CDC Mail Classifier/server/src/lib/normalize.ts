import type { gmail_v1 } from 'googleapis';
import { config } from '../config.js';
import { buildGmailLink } from './gmail.js';
import type { NormalizedEmail } from '../types/index.js';

interface HeaderMap {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const found = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? '';
}

function parseFromField(from: string): { fromName: string; fromEmail: string } {
  const match = from.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
  if (match) {
    return {
      fromName: (match[1] ?? '').trim(),
      fromEmail: (match[2] ?? from).trim(),
    };
  }
  return { fromName: '', fromEmail: from.trim() };
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function trimQuotedReply(body: string): string {
  let text = body;

  const patterns = [
    /\r?\nOn .+ wrote:\r?\n[\s\S]*/i,
    /\r?\n-----Original Message-----\r?\n[\s\S]*/i,
    /\r?\nFrom:.+\r?\nSent:.+\r?\nTo:.+\r?\nSubject:.+\r?\n[\s\S]*/i,
    /\r?\n_{3,}\r?\n[\s\S]*/i,
  ];

  for (const pattern of patterns) {
    text = text.replace(pattern, '');
  }

  const lines = text.split(/\r?\n/);
  const filtered: string[] = [];
  for (const line of lines) {
    if (/^>+/.test(line.trim())) break;
    filtered.push(line);
  }

  return filtered.join('\n').trim();
}

function extractBodyFromPart(part: gmail_v1.Schema$MessagePart): { plain?: string; html?: string } {
  const result: { plain?: string; html?: string } = {};

  if (part.mimeType === 'text/plain' && part.body?.data) {
    result.plain = decodeBase64Url(part.body.data);
  } else if (part.mimeType === 'text/html' && part.body?.data) {
    result.html = decodeBase64Url(part.body.data);
  }

  if (part.parts) {
    for (const child of part.parts) {
      const childResult = extractBodyFromPart(child);
      if (childResult.plain && !result.plain) result.plain = childResult.plain;
      if (childResult.html && !result.html) result.html = childResult.html;
    }
  }

  return result;
}

function extractAttachments(part: gmail_v1.Schema$MessagePart | undefined, names: string[]): void {
  if (!part) return;

  if (part.filename && part.filename.length > 0) {
    names.push(part.filename);
  }

  if (part.parts) {
    for (const child of part.parts) {
      extractAttachments(child, names);
    }
  }
}

function resolveBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  const { plain, html } = extractBodyFromPart(payload);

  let body = plain ?? (html ? stripHtml(html) : '');

  if (!body && payload.body?.data) {
    body = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') {
      body = stripHtml(body);
    }
  }

  body = trimQuotedReply(body);
  body = body.replace(/\r\n/g, '\n').trim();

  if (body.length > config.bodyMaxLength) {
    body = body.slice(0, config.bodyMaxLength);
  }

  return body;
}

export function normalizeGmailMessage(
  message: gmail_v1.Schema$Message,
  inboxLabel: string,
): NormalizedEmail {
  const headers: HeaderMap = {
    from: getHeader(message.payload?.headers, 'From'),
    to: getHeader(message.payload?.headers, 'To'),
    cc: getHeader(message.payload?.headers, 'Cc'),
    subject: getHeader(message.payload?.headers, 'Subject'),
    date: getHeader(message.payload?.headers, 'Date'),
  };

  const { fromName, fromEmail } = parseFromField(headers.from);
  const attachments: string[] = [];
  extractAttachments(message.payload, attachments);

  const messageId = message.id ?? '';
  const sentDate = headers.date ? new Date(headers.date) : new Date();

  return {
    messageId,
    threadId: message.threadId ?? '',
    inbox: inboxLabel,
    fromName,
    fromEmail,
    toField: headers.to,
    ccField: headers.cc,
    subject: headers.subject,
    sentDate: Number.isNaN(sentDate.getTime()) ? new Date() : sentDate,
    body: resolveBody(message.payload),
    attachments,
    gmailLink: buildGmailLink(messageId),
  };
}

/** Sanity check helper for unit-style validation of normalization output. */
export function validateNormalizedEmail(email: NormalizedEmail): string[] {
  const errors: string[] = [];
  if (!email.messageId) errors.push('messageId is required');
  if (email.body.length > config.bodyMaxLength) {
    errors.push(`body exceeds ${config.bodyMaxLength} chars`);
  }
  return errors;
}
