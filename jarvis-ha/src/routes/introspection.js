import { Router } from 'express';
import { getCatalogCached } from '../catalogService.js';

const router = Router();

router.get('/entities', async (_req, res) => {
  const cat = await getCatalogCached();
  res.json(cat.entities);
});


export default router;