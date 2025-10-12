import { Router } from 'express';
import { callService, getState } from '../homeAssistantClient.js';
import { getCatalogCached } from '../catalogService.js';
import { parseToAction } from '../nlp.js';
import { normalizeTargets } from '../utils/validators.js';
import { ALLOWED_INTENTS, ENTITY_RE } from '../constants.js';

const router = Router();

router.post('/intent/parse', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const act = await parseToAction(text);
  return res.json(act);
});

router.post('/', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });

    const catalog = await getCatalogCached();
    let act = await parseToAction(text, catalog);
    
    // Debug logging
    console.log('Parsed action:', JSON.stringify(act));
    
    // OVERRIDE: Fix common temperature/humidity queries that NLP fails to parse
    const lowerText = text.toLowerCase();
    if (lowerText.includes('temperature') && !act.intent?.includes('TEMP')) {
      console.log('OVERRIDE: Detected temperature query, forcing GET_TEMPERATURE');
      act = { intent: 'GET_TEMPERATURE' };
    } else if (lowerText.includes('humidity') && !act.intent?.includes('HUMID')) {
      console.log('OVERRIDE: Detected humidity query, forcing GET_HUMIDITY');
      act = { intent: 'GET_HUMIDITY' };
    } else if (lowerText.includes('motion') && !act.intent?.includes('MOTION')) {
      console.log('OVERRIDE: Detected motion query, forcing GET_MOTION');
      act = { intent: 'GET_MOTION' };
    }

    if (act.intent === 'EXPLAIN_UNSUPPORTED') {
      return res.status(400).json({ error: 'unsupported', act });
    }

    if (!ALLOWED_INTENTS.has(act.intent)) {
      return res.status(400).json({ error: 'intent not allowed', act });
    }

    const targets = normalizeTargets(act);
    if (act.intent !== 'GET_STATE' && !targets) {
      return res.status(400).json({ error: 'no valid target entity', act, hint: 'use /introspect/entities to see available ids' });
    }

    let result;
    switch (act.intent) {
      case 'LIGHT_ON':
        result = await callService('light', 'turn_on', { entity_id: targets.length === 1 ? targets[0] : targets });
        break;
      case 'LIGHT_OFF':
        result = await callService('light', 'turn_off', { entity_id: targets.length === 1 ? targets[0] : targets });
        break;
      case 'LIGHT_SET_BRIGHTNESS': {
        const brightness_pct = Math.max(0, Math.min(100, Number(act.brightness_pct ?? 100)));
        result = await callService('light', 'turn_on', { entity_id: targets.length === 1 ? targets[0] : targets, brightness_pct });
        break;
      }
      case 'SWITCH_ON':
        result = await callService('switch', 'turn_on', { entity_id: targets[0] });
        break;
      case 'SWITCH_OFF':
        result = await callService('switch', 'turn_off', { entity_id: targets[0] });
        break;
      case 'GET_STATE': {
        // Only use act.entity_id if it's a valid entity format
        let id;
        if (act.entity_id && ENTITY_RE.test(act.entity_id)) {
          id = act.entity_id;
        } else if (targets && targets[0]) {
          id = targets[0];
        } else {
          // If no valid entity, return error
          return res.status(400).json({ 
            error: 'No valid entity specified', 
            act,
            hint: 'Please specify a valid entity ID like sensor.temperature' 
          });
        }
        result = await getState(id);
        break;
      }
      case 'LIGHT_TOGGLE':
        result = await callService('light', 'toggle', { entity_id: targets.length === 1 ? targets[0] : targets });
        break;
      case 'SWITCH_TOGGLE':
        result = await callService('switch', 'toggle', { entity_id: targets[0] });
        break;
      case 'GET_TEMPERATURE': {
        // Force use default sensor unless a VALID entity_id is provided
        const id = (act.entity_id && act.entity_id.startsWith('sensor.')) ? act.entity_id : 'sensor.centralite_3310_g_temperature';
        console.log(`GET_TEMPERATURE: Using sensor ${id}`);
        try {
          const s = await getState(id);
          return res.json({
            act, result: {
              entity: s.entity_id,
              value: s.state,
              unit: s.attributes.unit_of_measurement || ''
            }
          });
        } catch (error) {
          if (error.response?.status === 404) {
            return res.json({
              act, result: {
                error: `Temperature sensor '${id}' not found. Please check your sensor entity IDs in Home Assistant.`,
                suggestion: "Try 'sensor.temperature' or check your HA dashboard for the correct entity ID."
              }
            });
          }
          throw error;
        }
      }
      case 'GET_HUMIDITY': {
        // Force use default sensor unless a VALID entity_id is provided
        const id = (act.entity_id && act.entity_id.startsWith('sensor.')) ? act.entity_id : 'sensor.centralite_3310_g_humidity';
        console.log(`GET_HUMIDITY: Using sensor ${id}`);
        try {
          const s = await getState(id);
          return res.json({
            act, result: {
              entity: s.entity_id,
              value: s.state,
              unit: s.attributes.unit_of_measurement || '%'
            }
          });
        } catch (error) {
          if (error.response?.status === 404) {
            return res.json({
              act, result: {
                error: `Humidity sensor '${id}' not found. Please check your sensor entity IDs in Home Assistant.`,
                suggestion: "Try 'sensor.humidity' or check your HA dashboard for the correct entity ID."
              }
            });
          }
          throw error;
        }
      }
      case 'GET_MOTION': {
        const id = act.entity_id && ENTITY_RE.test(act.entity_id) ? act.entity_id : 'binary_sensor.motion_sensor';
        const s = await getState(id);
        return res.json({
          act, result: {
            entity: s.entity_id,
            motion: s.state === 'on',
            state: s.state,
            last_changed: s.last_changed
          }
        });
      }
      default:
        return res.status(400).json({ error: 'unhandled intent', act });
    }

    return res.json({ act, result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;