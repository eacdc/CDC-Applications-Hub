import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3002),
  mongodbUri: requireEnv('MONGODB_URI'),
  openaiApiKey: requireEnv('OPENAI_API_KEY'),
  googleClientId: requireEnv('GOOGLE_CLIENT_ID'),
  googleClientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: requireEnv('GOOGLE_REDIRECT_URI'),
  encryptionKey: requireEnv('ENCRYPTION_KEY'),
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5175',
  /** Verify these model names are enabled on your OpenAI account. */
  models: {
    cheap: 'gpt-5-nano',
    strong: 'gpt-5.4-mini',
  },
  poll: {
    cronExpression: '* * * * *',
    lookbackMinutes: 5,
    confidenceEscalationThreshold: 0.6,
    reviewThreshold: 0.7,
  },
  bodyMaxLength: 8000,
  thread: {
    maxMessages: Number(process.env.THREAD_MAX_MESSAGES ?? 20),
    messageBodyMaxLength: Number(process.env.THREAD_MESSAGE_BODY_MAX ?? 2500),
  },
  /** AI agent input/output logs are auto-deleted after this many days (MongoDB TTL). */
  agentLogRetentionDays: Number(process.env.AGENT_LOG_RETENTION_DAYS ?? 30),
  /** Comma-separated domains treated as internal CDC staff email (e.g. cdcprinters.com). */
  cdcEmailDomains: (process.env.CDC_EMAIL_DOMAINS ?? 'cdcprinters.com,cdc.in')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  sql: {
    server: process.env.DB_SERVER ?? process.env.DB_HOST ?? '',
    port: Number(process.env.DB_PORT || 1433),
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME_KOL ?? process.env.DB_NAME ?? '',
  },
} as const;
