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
} as const;
