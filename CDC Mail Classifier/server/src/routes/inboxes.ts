import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Inbox } from '../models/Inbox.js';
import { encrypt } from '../lib/encryption.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    // Project refreshToken purely so we can derive a `connected` boolean,
    // then strip the actual token from the response.
    const inboxes = await Inbox.find().sort({ label: 1 }).lean();
    const safe = inboxes.map(({ refreshToken, ...rest }) => ({
      ...rest,
      connected: !!refreshToken,
    }));
    res.json(safe);
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

/**
 * Permanently delete an inbox record. Refuses if the inbox is still
 * connected (i.e. still has a refreshToken) — caller must disconnect
 * first so it's a two-step destructive action.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid inbox id' });
      return;
    }

    const inbox = await Inbox.findById(id);
    if (!inbox) {
      res.status(404).json({ error: 'Inbox not found' });
      return;
    }
    if (inbox.refreshToken) {
      res.status(409).json({
        error: 'Inbox is still connected. Disconnect it before deleting.',
      });
      return;
    }

    await Inbox.findByIdAndDelete(id);
    res.json({ deleted: true, _id: id });
  } catch (err) {
    console.error('[API] DELETE /inboxes/:id error', err);
    res.status(500).json({ error: 'Failed to delete inbox' });
  }
});

/**
 * Clear an inbox's stored refresh token so the poller stops fetching from it.
 * The inbox record is preserved (label, email address, history) and can be
 * re-connected later with a fresh OAuth flow.
 */
router.post('/:id/disconnect', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid inbox id' });
      return;
    }

    const updated = await Inbox.findByIdAndUpdate(
      id,
      { $unset: { refreshToken: '' } },
      { new: true },
    ).select('-refreshToken').lean();

    if (!updated) {
      res.status(404).json({ error: 'Inbox not found' });
      return;
    }

    res.json({ ...updated, connected: false });
  } catch (err) {
    console.error('[API] POST /inboxes/:id/disconnect error', err);
    res.status(500).json({ error: 'Failed to disconnect inbox' });
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
