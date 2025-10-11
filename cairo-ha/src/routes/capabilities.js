import { Router } from 'express';
import { getCatalogCached } from '../catalogService.js';

const router = Router();

router.get('/', async (_req, res) => {
  const cat = await getCatalogCached();
  res.json(cat);
});

export default router;