import { Router } from 'express';
import { getState, getHistory } from '../homeAssistantClient.js';

const router = Router();

router.get('/state', async (req, res) => {
  const id = req.query.entity;
  if (!id) return res.status(400).json({ error: 'entity required' });
  res.json(await getState(id));
});

router.get('/sensor', async (req, res) => {
  const id = req.query.entity;
  if (!id) return res.status(400).json({ error: 'entity required' });
  const s = await getState(id);
  res.json({
    entity: s.entity_id,
    value: s.state,
    unit: s.attributes.unit_of_measurement || '',
    last_changed: s.last_changed
  });
});

router.get('/motion', async (req, res) => {
  const id = req.query.entity || 'binary_sensor.motion_sensor';
  const s = await getState(id);
  res.json({ entity: s.entity_id, motion: s.state === 'on', state: s.state, last_changed: s.last_changed });
});

router.get('/humidity', async (req, res) => {
  const id = req.query.entity || 'sensor.centralite_3310_g_humidity';
  const s = await getState(id);
  res.json({ entity: s.entity_id, value: s.state, unit: s.attributes.unit_of_measurement || '%' });
});

router.get('/history', async (req, res) => {
  const id = req.query.entity;
  const hours = req.query.hours || 6;
  if (!id) return res.status(400).json({ error: 'entity required' });
  res.json(await getHistory(id, hours));
});

export default router;