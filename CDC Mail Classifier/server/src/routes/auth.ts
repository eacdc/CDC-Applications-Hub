import { Router, type Request, type Response } from 'express';
import { getAuthUrl, exchangeCodeForTokens } from '../lib/gmail.js';
import { storeInboxRefreshToken } from './inboxes.js';
import { config } from '../config.js';

const router = Router();

interface OAuthState {
  label?: string;
  emailAddress?: string;
}

function encodeState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

function decodeState(state: string): OAuthState {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as OAuthState;
  } catch {
    return {};
  }
}

router.get('/google', (req: Request, res: Response) => {
  const { label, emailAddress } = req.query;
  const state = encodeState({
    label: typeof label === 'string' ? label : undefined,
    emailAddress: typeof emailAddress === 'string' ? emailAddress : undefined,
  });
  const url = getAuthUrl(state);
  res.redirect(url);
});

router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state: stateParam, error } = req.query;

    if (error) {
      res.status(400).send(`OAuth error: ${String(error)}`);
      return;
    }

    if (typeof code !== 'string') {
      res.status(400).json({ error: 'Missing authorization code' });
      return;
    }

    const state = typeof stateParam === 'string' ? decodeState(stateParam) : {};
    const tokens = await exchangeCodeForTokens(code);

    const emailAddress = state.emailAddress;
    if (!emailAddress) {
      res.status(400).json({
        error: 'emailAddress must be provided in the OAuth start URL (?emailAddress=...)',
      });
      return;
    }

    await storeInboxRefreshToken(emailAddress, tokens.refresh_token!, state.label);

    res.redirect(`${config.clientUrl}/inboxes?connected=${encodeURIComponent(emailAddress)}`);
  } catch (err) {
    console.error('[Auth] Google callback error', err);
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

export default router;
