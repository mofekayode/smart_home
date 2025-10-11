import { Router } from 'express';
import { getCatalogCached } from '../catalogService.js';

const router = Router();

router.get('/', async (_req, res) => {
  const cat = await getCatalogCached();
  const out = {
    message: 'I can control lights and switches, and read sensors I can see',
    capabilities: cat.capabilities,
    sample_entities: cat.entities
  };
  res.json(out);
});

export default router;