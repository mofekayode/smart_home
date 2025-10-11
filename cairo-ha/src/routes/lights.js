import { Router } from 'express';
import { callService } from '../homeAssistantClient.js';

const router = Router();

router.post('/on', async (req, res) => {
  const q = (req.query.entity || 'light.short_lamp').toString();
  const ids = q.includes(',') ? q.split(',').map(s => s.trim()) : q;
  const { brightness_pct, color_temp_kelvin, rgb_color, transition, area_id } = req.body || {};

  const data = {
    ...(area_id !== undefined ? { area_id } : {}),
    entity_id: ids,
    ...(brightness_pct !== undefined ? { brightness_pct: Number(brightness_pct) } : {}),
    ...(color_temp_kelvin !== undefined ? { color_temp_kelvin: Number(color_temp_kelvin) } : {}),
    ...(rgb_color !== undefined ? { rgb_color } : {}),
    ...(transition !== undefined ? { transition: Number(transition) } : {}),
  };
  res.json(await callService('light', 'turn_on', data));
});

router.post('/off', async (req, res) => {
  const q = (req.query.entity || 'light.short_lamp').toString();
  const ids = q.includes(',') ? q.split(',').map(s => s.trim()) : q;
  const { transition, area_id } = req.body || {};
  
  const data = {
    ...(area_id !== undefined ? { area_id } : {}),
    entity_id: ids,
    ...(transition !== undefined ? { transition: Number(transition) } : {}),
  };
  res.json(await callService('light', 'turn_off', data));
});

export default router;