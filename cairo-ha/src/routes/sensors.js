import { Router } from 'express';
import { getState, getHistory } from '../homeAssistantClient.js';

const router = Router();

router.get('/state', async (req, res) => {
  const id = req.query.entity;
  console.log(`/state endpoint called with entity: "${id}"`);
  console.log('Call stack:', new Error().stack);
  
  if (!id) return res.status(400).json({ error: 'entity required' });
  
  // BLOCK invalid entity IDs completely
  if (id === 'temperature' || id === 'humidity' || id === 'motion') {
    console.log(`BLOCKED: Invalid entity ID "${id}" - returning error`);
    return res.status(400).json({
      error: `Invalid entity ID: "${id}"`,
      message: `Entity IDs must be in format 'domain.name' like 'sensor.temperature', not just '${id}'`,
      suggestion: 'Use the /command endpoint instead for natural language queries'
    });
  }
  
  try {
    const state = await getState(id);
    res.json(state);
  } catch (error) {
    console.error(`Failed to get state for entity ${id}:`, error.message);
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: `Entity '${id}' not found in Home Assistant`,
        suggestion: 'Check your Home Assistant for valid entity IDs'
      });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/sensor', async (req, res) => {
  const id = req.query.entity;
  if (!id) return res.status(400).json({ error: 'entity required' });
  
  try {
    const s = await getState(id);
    res.json({
      entity: s.entity_id,
      value: s.state,
      unit: s.attributes.unit_of_measurement || '',
      last_changed: s.last_changed
    });
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: `Sensor '${id}' not found in Home Assistant`,
        suggestion: 'Check your Home Assistant for valid sensor entity IDs'
      });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/motion', async (req, res) => {
  const id = req.query.entity || 'binary_sensor.motion_sensor';
  try {
    const s = await getState(id);
    res.json({ entity: s.entity_id, motion: s.state === 'on', state: s.state, last_changed: s.last_changed });
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: `Motion sensor '${id}' not found in Home Assistant`,
        suggestion: 'Check your Home Assistant for valid motion sensor entity IDs'
      });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/humidity', async (req, res) => {
  const id = req.query.entity || 'sensor.centralite_3310_g_humidity';
  try {
    const s = await getState(id);
    res.json({ entity: s.entity_id, value: s.state, unit: s.attributes.unit_of_measurement || '%' });
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: `Humidity sensor '${id}' not found in Home Assistant`,
        suggestion: 'Check your Home Assistant for valid humidity sensor entity IDs'
      });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/history', async (req, res) => {
  const id = req.query.entity;
  const hours = req.query.hours || 6;
  if (!id) return res.status(400).json({ error: 'entity required' });
  res.json(await getHistory(id, hours));
});

export default router;