import { Router, type Request, type Response } from 'express';
import { Inbox } from '../models/Inbox.js';
import { encrypt } from '../lib/encryption.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const inboxes = await Inbox.find().select('-refreshToken').sort({ label: 1 }).lean();
    res.json(inboxes);
  } catch (err) {
    console.error('[API] GET /inboxes error', err);
    res.status(500).json({ error: 'Failed to list inboxes' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { label, emailAddress, active } = req.body as {
      label?: string;
      emailAddress?: string;
      active?: boolean;
    };

    if (!emailAddress) {
      res.status(400).json({ error: 'emailAddress is required' });
      return;
    }

    const inbox = await Inbox.findOneAndUpdate(
      { emailAddress },
      {
        $set: {
          label: label ?? emailAddress.split('@')[0],
          active: active ?? true,
        },
        $setOnInsert: { emailAddress },
      },
      { upsert: true, new: true },
    ).select('-refreshToken');

    res.status(201).json(inbox);
  } catch (err) {
    console.error('[API] POST /inboxes error', err);
    res.status(500).json({ error: 'Failed to create inbox' });
  }
});

export async function storeInboxRefreshToken(
  emailAddress: string,
  refreshToken: string,
  label?: string,
): Promise<void> {
  const encrypted = encrypt(refreshToken);
  await Inbox.findOneAndUpdate(
    { emailAddress },
    {
      $set: {
        refreshToken: encrypted,
        label: label ?? emailAddress.split('@')[0],
        active: true,
      },
      $setOnInsert: { emailAddress },
    },
    { upsert: true },
  );
}

export default router;
