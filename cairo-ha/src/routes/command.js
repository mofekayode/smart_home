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
    
    // Check for combined temperature AND humidity query
    if (lowerText.includes('temperature') && lowerText.includes('humidity')) {
      console.log('OVERRIDE: Detected combined climate query, forcing GET_CLIMATE');
      act = { intent: 'GET_CLIMATE' };
    } else if (lowerText.includes('temperature') && !act.intent?.includes('TEMP')) {
      console.log('OVERRIDE: Detected temperature query, forcing GET_TEMPERATURE');
      act = { intent: 'GET_TEMPERATURE' };
    } else if (lowerText.includes('humidity') && !act.intent?.includes('HUMID')) {
      console.log('OVERRIDE: Detected humidity query, forcing GET_HUMIDITY');
      act = { intent: 'GET_HUMIDITY' };
    } else if (lowerText.includes('motion') && !act.intent?.includes('MOTION')) {
      console.log('OVERRIDE: Detected motion query, forcing GET_MOTION');
      act = { intent: 'GET_MOTION' };
    } else if (lowerText.includes('mood') && lowerText.includes('read')) {
      // Reading mode - bright lights
      console.log('OVERRIDE: Converting "reading mood" to 70% brightness');
      act = { 
        intent: 'LIGHT_SET_BRIGHTNESS', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: 70 
      };
    } else if (lowerText.includes('movie')) {
      // Movie mode - dim lights
      console.log('OVERRIDE: Converting "movie mode" to 20% brightness');
      act = { 
        intent: 'LIGHT_SET_BRIGHTNESS', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: 20 
      };
    } else if (lowerText.includes('bedtime') || (lowerText.includes('prepare') && lowerText.includes('bed'))) {
      // Bedtime - lights off
      console.log('OVERRIDE: Converting "bedtime" to lights off');
      act = { 
        intent: 'LIGHT_OFF', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp']
      };
    } else if (lowerText.includes('wake') && (lowerText.includes('house') || lowerText.includes('up'))) {
      // Wake up - everything on
      console.log('OVERRIDE: Converting "wake up" to lights full brightness');
      act = { 
        intent: 'LIGHT_SET_BRIGHTNESS', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: 100 
      };
    }

    // Handle complex scenarios by converting them to actionable intents
    if (act.intent === 'EXPLAIN_UNSUPPORTED' || !act.intent) {
      console.log('[COMMAND] Handling complex scenario:', text);
      
      const lowerCmd = text.toLowerCase();
      
      // Convert complex scenarios to specific actions
      if (lowerCmd.includes('mood') && lowerCmd.includes('read')) {
        // Reading mode - bright lights
        console.log('[COMMAND] Converting "reading mood" to 70% brightness');
        act = { 
          intent: 'LIGHT_SET_BRIGHTNESS', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp'],
          brightness_pct: 70 
        };
      } else if (lowerCmd.includes('movie') || lowerCmd.includes('film')) {
        // Movie mode - dim lights
        console.log('[COMMAND] Converting "movie mode" to 20% brightness');
        act = { 
          intent: 'LIGHT_SET_BRIGHTNESS', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp'],
          brightness_pct: 20 
        };
      } else if (lowerCmd.includes('bedtime') || lowerCmd.includes('sleep')) {
        // Bedtime - lights off or very dim
        console.log('[COMMAND] Converting "bedtime" to lights off');
        act = { 
          intent: 'LIGHT_OFF', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp']
        };
      } else if (lowerCmd.includes('wake') && lowerCmd.includes('house')) {
        // Wake up - everything on
        console.log('[COMMAND] Converting "wake up house" to lights on full');
        act = { 
          intent: 'LIGHT_SET_BRIGHTNESS', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp'],
          brightness_pct: 100 
        };
      } else if (lowerCmd.includes('everything off') || lowerCmd.includes('all off')) {
        // Everything off
        console.log('[COMMAND] Converting "everything off" to lights off');
        act = { 
          intent: 'LIGHT_OFF', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp']
        };
      } else {
        // For truly ambiguous commands, provide suggestions
        console.log('[COMMAND] Unclear intent, providing suggestions for:', text);
        
        const suggestions = [];
        
        // Check for partial matches to provide better suggestions
        if (lowerCmd.includes('switch') || lowerCmd.includes('bot')) {
          suggestions.push('"Turn on bot1"', '"Turn off the switch"', '"Toggle bot1"');
        }
        if (lowerCmd.includes('toggle') && !lowerCmd.includes('lamp')) {
          suggestions.push('"Toggle the tall lamp"', '"Toggle the short lamp"', '"Toggle bot1"');
        }
        
        // If no specific suggestions, provide general help
        if (suggestions.length === 0) {
          suggestions.push(
            '"Turn on the lights"',
            '"What\'s the temperature?"',
            '"Check motion sensor"',
            '"List my automations"'
          );
        }
        
        return res.json({
          act: { intent: 'CLARIFICATION_NEEDED', original_text: text },
          clarification: true,
          message: `I'm not quite sure what you mean by "${text}". Did you mean one of these?`,
          suggestions,
          help: 'Try rephrasing your command or choose from the suggestions above.'
        });
      }
    }

    if (!ALLOWED_INTENTS.has(act.intent)) {
      return res.status(400).json({ error: 'intent not allowed', act });
    }

    const targets = normalizeTargets(act);
    // Skip target validation for intents that have default sensors
    const intentsWithDefaults = ['GET_TEMPERATURE', 'GET_HUMIDITY', 'GET_MOTION', 'GET_STATE', 'GET_CLIMATE'];
    if (!intentsWithDefaults.includes(act.intent) && !targets) {
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
            console.log(`Temperature sensor ${id} not found, using mock data`);
            // Return mock data for testing when sensor doesn't exist
            return res.json({
              act, result: {
                entity: id,
                value: "72",
                unit: "°F",
                mock: true,
                message: "Using mock data - sensor not found in Home Assistant"
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
            console.log(`Humidity sensor ${id} not found, using mock data`);
            // Return mock data for testing when sensor doesn't exist
            return res.json({
              act, result: {
                entity: id,
                value: "45",
                unit: "%",
                mock: true,
                message: "Using mock data - sensor not found in Home Assistant"
              }
            });
          }
          throw error;
        }
      }
      case 'GET_CLIMATE': {
        // Get both temperature and humidity in parallel
        const tempId = 'sensor.centralite_3310_g_temperature';
        const humidId = 'sensor.centralite_3310_g_humidity';
        
        console.log(`GET_CLIMATE: Fetching both temperature and humidity`);
        
        try {
          // Fetch both in parallel for speed
          const [tempResult, humidResult] = await Promise.allSettled([
            getState(tempId),
            getState(humidId)
          ]);
          
          const response = { act };
          const results = {};
          
          // Handle temperature result
          if (tempResult.status === 'fulfilled') {
            results.temperature = {
              value: tempResult.value.state,
              unit: tempResult.value.attributes.unit_of_measurement || '°F',
              entity: tempId
            };
          } else {
            results.temperature = {
              value: "72",
              unit: "°F",
              mock: true,
              error: "Sensor not found"
            };
          }
          
          // Handle humidity result  
          if (humidResult.status === 'fulfilled') {
            results.humidity = {
              value: humidResult.value.state,
              unit: humidResult.value.attributes.unit_of_measurement || '%',
              entity: humidId
            };
          } else {
            results.humidity = {
              value: "45",
              unit: "%",
              mock: true,
              error: "Sensor not found"
            };
          }
          
          response.result = results;
          return res.json(response);
          
        } catch (error) {
          console.error('GET_CLIMATE error:', error);
          return res.status(500).json({ error: error.message });
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
        // For any unhandled intent, provide clarification
        console.log('[COMMAND] Unhandled intent:', act.intent);
        return res.json({
          act: { intent: 'CLARIFICATION_NEEDED', original_intent: act.intent },
          clarification: true,
          message: `I don't know how to handle "${act.intent}" yet.`,
          suggestions: [
            '"Turn on the lights"',
            '"What\'s the temperature?"',
            '"List my automations"'
          ],
          help: 'Try one of the suggestions above or rephrase your request.'
        });
    }

    return res.json({ act, result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;