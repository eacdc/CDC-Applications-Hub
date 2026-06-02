import { Router, type Request, type Response } from 'express';
import { Email } from '../models/Email.js';
import { config } from '../config.js';
import type { StatsResponse } from '../types/index.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalToday, needsReview, departmentAgg, mailTypeAgg, classifierAgg, totalAll] =
      await Promise.all([
        Email.countDocuments({ sentDate: { $gte: startOfToday } }),
        Email.countDocuments({ needsReview: true }),
        Email.aggregate<{ _id: string; count: number }>([
          { $match: { department: { $nin: [null, ''] } } },
          { $group: { _id: '$department', count: { $sum: 1 } } },
        ]),
        Email.aggregate<{ _id: string; count: number }>([
          { $match: { mailType: { $nin: [null, ''] } } },
          { $group: { _id: '$mailType', count: { $sum: 1 } } },
        ]),
        Email.aggregate<{ _id: string; count: number }>([
          { $match: { classifier: { $nin: [null, ''] } } },
          { $group: { _id: '$classifier', count: { $sum: 1 } } },
        ]),
        Email.countDocuments(),
      ]);

    const byDepartment: Record<string, number> = {};
    for (const row of departmentAgg) {
      if (row._id) byDepartment[row._id] = row.count;
    }

    const byMailType: Record<string, number> = {};
    for (const row of mailTypeAgg) {
      if (row._id) byMailType[row._id] = row.count;
    }

    let nano = 0;
    let mini = 0;
    for (const row of classifierAgg) {
      if (row._id === config.models.cheap) nano = row.count;
      else if (row._id === config.models.strong) mini = row.count;
    }

    const stats: StatsResponse = {
      totalToday,
      needsReview,
      byDepartment,
      byMailType,
      reviewPercent: totalAll > 0 ? Math.round((needsReview / totalAll) * 1000) / 10 : 0,
      classifierSplit: { nano, mini },
    };

    res.json(stats);
  } catch (err) {
    console.error('[API] GET /stats error', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
