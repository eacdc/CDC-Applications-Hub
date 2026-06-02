import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Email } from '../models/Email.js';
import type { EmailUpdatePayload } from '../types/index.js';
import { classifyEmail, classificationToEmailFields } from '../lib/classifier.js';

const router = Router();

function parseBool(value: unknown): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      department,
      mailType,
      needsReview,
      inbox,
      search,
      dateFrom,
      dateTo,
      page = '1',
      limit = '25',
    } = req.query;

    const filter: Record<string, unknown> = {};

    if (typeof department === 'string' && department) filter.department = department;
    if (typeof mailType === 'string' && mailType) filter.mailType = mailType;
    if (typeof inbox === 'string' && inbox) filter.inbox = inbox;

    const reviewFilter = parseBool(needsReview);
    if (reviewFilter !== undefined) filter.needsReview = reviewFilter;

    if (typeof dateFrom === 'string' || typeof dateTo === 'string') {
      const sentDate: Record<string, Date> = {};
      if (typeof dateFrom === 'string' && dateFrom) {
        sentDate.$gte = new Date(dateFrom);
      }
      if (typeof dateTo === 'string' && dateTo) {
        sentDate.$lte = new Date(dateTo);
      }
      filter.sentDate = sentDate;
    }

    if (typeof search === 'string' && search.trim()) {
      const term = search.trim();
      filter.$or = [
        { subject: { $regex: term, $options: 'i' } },
        { fromEmail: { $regex: term, $options: 'i' } },
        { fromName: { $regex: term, $options: 'i' } },
        { clientName: { $regex: term, $options: 'i' } },
        { jobNumber: { $regex: term, $options: 'i' } },
        { summary: { $regex: term, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const [emails, total] = await Promise.all([
      Email.find(filter).sort({ sentDate: -1 }).skip(skip).limit(limitNum).lean(),
      Email.countDocuments(filter),
    ]);

    res.json({
      emails,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('[API] GET /emails error', err);
    res.status(500).json({ error: 'Failed to list emails' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid email id' });
      return;
    }

    const email = await Email.findById(id).lean();
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    res.json(email);
  } catch (err) {
    console.error('[API] GET /emails/:id error', err);
    res.status(500).json({ error: 'Failed to fetch email' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid email id' });
      return;
    }

    const body = req.body as EmailUpdatePayload;
    const update: Record<string, unknown> = { reviewed: true };

    const fieldMap: Record<keyof EmailUpdatePayload, string> = {
      department: 'department',
      mailType: 'mailType',
      jobNumber: 'jobNumber',
      clientName: 'clientName',
      isbn: 'isbn',
      title: 'title',
      quantity: 'quantity',
      dueDate: 'dueDate',
      summary: 'summary',
      actionRequired: 'actionRequired',
      typeSpecific: 'typeSpecific',
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
      const k = key as keyof EmailUpdatePayload;
      if (body[k] !== undefined) {
        update[dbField] = body[k];
      }
    }

    update.needsReview = false;

    const email = await Email.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    res.json(email);
  } catch (err) {
    console.error('[API] PATCH /emails/:id error', err);
    res.status(500).json({ error: 'Failed to update email' });
  }
});

export default router;

export async function reclassifyEmailById(id: string): Promise<Record<string, unknown> | null> {
  const email = await Email.findById(id);
  if (!email) return null;

  const normalized = {
    messageId: email.messageId,
    threadId: email.threadId ?? '',
    inbox: email.inbox ?? '',
    fromName: email.fromName ?? '',
    fromEmail: email.fromEmail ?? '',
    toField: email.toField ?? '',
    ccField: email.ccField ?? '',
    subject: email.subject ?? '',
    sentDate: email.sentDate ?? new Date(),
    body: email.body ?? '',
    attachments: email.attachments ?? [],
    gmailLink: email.gmailLink ?? '',
  };

  const { result, modelUsed } = await classifyEmail(normalized);
  const fields = classificationToEmailFields(result, modelUsed);

  Object.assign(email, fields);
  email.reviewed = false;
  await email.save();

  return email.toObject() as Record<string, unknown>;
}
