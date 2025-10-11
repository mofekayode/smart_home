import { Router } from 'express';
import { callService } from '../homeAssistantClient.js';

const router = Router();

router.post('/on', async (req, res) => {
  const id = req.query.entity;
  if (!id) return res.status(400).json({ error: 'entity required (e.g. switch.bot1)' });
  res.json(await callService('switch', 'turn_on', { entity_id: id }));
});

router.post('/off', async (req, res) => {
  const id = req.query.entity;
  if (!id) return res.status(400).json({ error: 'entity required (e.g. switch.bot1)' });
  res.json(await callService('switch', 'turn_off', { entity_id: id }));
});

export default router;