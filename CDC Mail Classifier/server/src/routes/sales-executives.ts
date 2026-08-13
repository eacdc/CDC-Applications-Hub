import { Router, type Request, type Response } from 'express';
import { fetchSalesExecutiveNames, isSqlConfigured } from '../db-sql.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    if (!isSqlConfigured()) {
      res.status(503).json({ error: 'Sales executive lookup is not configured' });
      return;
    }

    const names = await fetchSalesExecutiveNames();
    res.json({ names });
  } catch (err) {
    console.error('[API] GET /sales-executives error', err);
    res.status(500).json({ error: 'Failed to fetch sales executives' });
  }
});

export default router;
