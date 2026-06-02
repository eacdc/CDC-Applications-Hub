import { google, gmail_v1 } from 'googleapis';
import { config } from '../config.js';
import { decrypt } from './encryption.js';

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );
}

export function getAuthUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh token received — revoke prior access and re-authorize with prompt=consent');
  }
  return tokens;
}

export function getGmailClient(refreshTokenEncrypted: string): gmail_v1.Gmail {
  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: decrypt(refreshTokenEncrypted) });
  return google.gmail({ version: 'v1', auth: client });
}

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('500')
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
        const delay = attempt * 1000;
        console.warn(`[Gmail] ${label} attempt ${attempt} failed, retrying in ${delay}ms`, err);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export async function fetchRecentMessageIds(
  gmail: gmail_v1.Gmail,
  lookbackMinutes: number,
): Promise<string[]> {
  const afterEpoch = Math.floor(Date.now() / 1000) - lookbackMinutes * 60;
  const query = `after:${afterEpoch}`;

  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await withRetry(
      () =>
        gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 100,
          pageToken,
        }),
      'messages.list',
    );

    for (const msg of res.data.messages ?? []) {
      if (msg.id) ids.push(msg.id);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return ids;
}

export async function fetchMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<gmail_v1.Schema$Message> {
  const res = await withRetry(
    () =>
      gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      }),
    `messages.get(${messageId})`,
  );
  if (!res.data) {
    throw new Error(`Empty response for message ${messageId}`);
  }
  return res.data;
}

export function buildGmailLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}
