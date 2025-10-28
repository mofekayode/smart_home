import { Router } from 'express';
import { callService, getState } from '../homeAssistantClient.js';
import { getCatalogCached } from '../catalogService.js';
import { parseToAction } from '../nlp.js';
import { normalizeTargets } from '../utils/validators.js';
import { ALLOWED_INTENTS, ENTITY_RE } from '../constants.js';

const router = Router();

// Check if running in test mode (for mock data)
const TEST_MODE = process.env.TEST_MODE === 'true';

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
    
    // OVERRIDE: Fix common queries that NLP fails to parse
    const lowerText = text.toLowerCase();

    // Check for brightness queries
    if ((lowerText.includes('what') || lowerText.includes('check') || lowerText.includes('current')) &&
        lowerText.includes('brightness')) {
      console.log('OVERRIDE: Detected brightness query, forcing GET_BRIGHTNESS');
      act = { intent: 'GET_BRIGHTNESS', entity_ids: ['light.short_lamp', 'light.tall_lamp'] };
    } else if (lowerText.includes('temperature') && lowerText.includes('humidity')) {
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
    } else if ((lowerText.includes('brightness') || lowerText.includes('bright') || lowerText.includes('dim')) && 
               (lowerText.includes('up') || lowerText.includes('increase') || lowerText.includes('higher') || 
                lowerText.includes('more') || lowerText.includes('raise'))) {
      // Increase brightness
      console.log('OVERRIDE: Detected brightness increase request');
      // Extract percentage if provided
      const percentMatch = lowerText.match(/(\d+)\s*%?/);
      const brightness = percentMatch ? parseInt(percentMatch[1]) : 80; // Default to 80% if not specified
      act = { 
        intent: 'LIGHT_SET_BRIGHTNESS', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: Math.min(100, brightness)
      };
    } else if ((lowerText.includes('brightness') || lowerText.includes('bright') || lowerText.includes('dim')) && 
               (lowerText.includes('down') || lowerText.includes('decrease') || lowerText.includes('lower') || 
                lowerText.includes('less') || lowerText.includes('reduce'))) {
      // Decrease brightness
      console.log('OVERRIDE: Detected brightness decrease request');
      const percentMatch = lowerText.match(/(\d+)\s*%?/);
      const brightness = percentMatch ? parseInt(percentMatch[1]) : 30; // Default to 30% if not specified
      act = { 
        intent: 'LIGHT_SET_BRIGHTNESS', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: Math.max(10, brightness)
      };
    } else if (lowerText.match(/\d+/) && (lowerText.includes('brightness') || lowerText.includes('%') || lowerText.includes('percent'))) {
      // ANY command with a number + brightness/percent -> use that EXACT number
      const percentMatch = lowerText.match(/(\d+)\s*(?:%|percent)?/);
      const brightness = percentMatch ? parseInt(percentMatch[1]) : 50;
      console.log(`OVERRIDE: User said ${brightness}% - USING EXACT VALUE`);
      act = {
        intent: 'LIGHT_SET_BRIGHTNESS',
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: Math.min(100, Math.max(0, brightness))
      };
    } else if ((lowerText.includes('set') || lowerText.includes('change')) &&
               (lowerText.includes('brightness') || lowerText.includes('lights'))) {
      // Set brightness without number - default to 50%
      console.log(`OVERRIDE: Setting brightness to default 50%`);
      act = {
        intent: 'LIGHT_SET_BRIGHTNESS',
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: 50
      };
    }

    // Handle greetings and simple responses first
    const lowerCmd = text.toLowerCase();
    
    // Check if this is a greeting or simple interaction
    const isGreeting = lowerCmd.includes('hello') || lowerCmd.includes('hi') || 
                      lowerCmd.includes('hey') || lowerCmd.includes('thanks') ||
                      lowerCmd.includes('thank you') || lowerCmd.includes('goodbye') ||
                      lowerCmd.includes('bye');
    
    // Check if this is a simple yes/no response (should be handled by chat.js context)
    const isSimpleResponse = (lowerCmd === 'yes' || lowerCmd === 'no' || 
                             lowerCmd === 'sure' || lowerCmd === 'okay' || 
                             lowerCmd === 'nah' || lowerCmd === 'nope');
    
    // If it's a greeting with Cairo's name or simple response, don't provide clarification
    if ((isGreeting && lowerCmd.includes('cairo')) || isSimpleResponse) {
      console.log('[COMMAND] Greeting or contextual response - passing through');
      return res.json({ 
        act: { intent: 'GREETING_OR_CONTEXT' },
        greeting: isGreeting,
        contextual: isSimpleResponse
      });
    }
    
    // Handle complex scenarios by converting them to actionable intents
    if (act.intent === 'EXPLAIN_UNSUPPORTED' || !act.intent) {
      console.log('[COMMAND] Handling complex scenario:', text);
      
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
        // For truly ambiguous commands, provide SMART context-aware suggestions
        console.log('[COMMAND] Unclear intent, providing suggestions for:', text);
        
        const suggestions = [];
        
        // Analyze what the user might be trying to do
        if (lowerCmd.includes('bright') || lowerCmd.includes('dim') || lowerCmd.includes('light')) {
          // They're talking about lights/brightness
          suggestions.push(
            '"Set lights to 50%"',
            '"Increase brightness to 80%"', 
            '"Dim the lights"',
            '"Turn lights up"'
          );
        } else if (lowerCmd.includes('switch') || lowerCmd.includes('bot')) {
          suggestions.push('"Turn on bot1"', '"Turn off the switch"', '"Toggle bot1"');
        } else if (lowerCmd.includes('toggle')) {
          suggestions.push('"Toggle the tall lamp"', '"Toggle the short lamp"', '"Toggle bot1"');
        } else if (lowerCmd.includes('temp') || lowerCmd.includes('humid') || lowerCmd.includes('climate')) {
          suggestions.push(
            '"What\'s the temperature?"',
            '"Check humidity"',
            '"What\'s the temperature and humidity?"'
          );
        } else if (lowerCmd.includes('motion') || lowerCmd.includes('sensor')) {
          suggestions.push(
            '"Check motion sensor"',
            '"Is there motion?"',
            '"What sensors do I have?"'
          );
        } else if (lowerCmd.includes('automat') || lowerCmd.includes('rule')) {
          suggestions.push(
            '"List my automations"',
            '"Show automation rules"',
            '"What automations are active?"'
          );
        } else {
          // Generic suggestions based on common patterns
          if (text.split(' ').length <= 2) {
            // Short command - might be missing context
            suggestions.push(
              '"Turn on the lights"',
              '"Set brightness to 70%"',
              '"Movie mode"',
              '"What\'s the temperature?"'
            );
          } else {
            // Longer command - try to be more specific
            suggestions.push(
              '"Turn on all lights"',
              '"Set living room to 50%"',
              '"Check all sensors"',
              '"List my devices"'
            );
          }
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
            // Only return mock data in TEST_MODE
            if (TEST_MODE) {
              console.log(`[TEST_MODE] Temperature sensor ${id} not found, using mock data`);
              return res.json({
                act, result: {
                  entity: id,
                  value: "72",
                  unit: "°F",
                  mock: true,
                  message: "Using mock data - sensor not found in Home Assistant"
                }
              });
            } else {
              // In production, return proper error
              console.error(`[PRODUCTION] Temperature sensor ${id} not found - returning error`);
              return res.json({
                act, result: {
                  error: `Temperature sensor '${id}' not found`,
                  suggestion: "Check if your temperature sensor is connected to Home Assistant",
                  entity: id
                }
              });
            }
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
            // Only return mock data in TEST_MODE
            if (TEST_MODE) {
              console.log(`[TEST_MODE] Humidity sensor ${id} not found, using mock data`);
              return res.json({
                act, result: {
                  entity: id,
                  value: "45",
                  unit: "%",
                  mock: true,
                  message: "Using mock data - sensor not found in Home Assistant"
                }
              });
            } else {
              // In production, return proper error
              console.error(`[PRODUCTION] Humidity sensor ${id} not found - returning error`);
              return res.json({
                act, result: {
                  error: `Humidity sensor '${id}' not found`,
                  suggestion: "Check if your humidity sensor is connected to Home Assistant",
                  entity: id
                }
              });
            }
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
            // Only return mock data in TEST_MODE
            if (TEST_MODE) {
              console.log(`[TEST_MODE] Temperature sensor failed, using mock data`);
              results.temperature = {
                value: "72",
                unit: "°F",
                mock: true,
                error: "Sensor not found"
              };
            } else {
              // In production, return error
              console.error(`[PRODUCTION] Temperature sensor ${tempId} not found`);
              results.temperature = {
                error: `Temperature sensor '${tempId}' not found`,
                suggestion: "Check if your temperature sensor is connected",
                entity: tempId
              };
            }
          }

          // Handle humidity result
          if (humidResult.status === 'fulfilled') {
            results.humidity = {
              value: humidResult.value.state,
              unit: humidResult.value.attributes.unit_of_measurement || '%',
              entity: humidId
            };
          } else {
            // Only return mock data in TEST_MODE
            if (TEST_MODE) {
              console.log(`[TEST_MODE] Humidity sensor failed, using mock data`);
              results.humidity = {
                value: "45",
                unit: "%",
                mock: true,
                error: "Sensor not found"
              };
            } else {
              // In production, return error
              console.error(`[PRODUCTION] Humidity sensor ${humidId} not found`);
              results.humidity = {
                error: `Humidity sensor '${humidId}' not found`,
                suggestion: "Check if your humidity sensor is connected",
                entity: humidId
              };
            }
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
      case 'GET_BRIGHTNESS': {
        // Get brightness of specified lights
        try {
          const brightnessResults = [];
          for (const entityId of targets) {
            const state = await getState(entityId);
            const brightness = state.attributes?.brightness || 0;
            const brightness_pct = Math.round((brightness / 255) * 100);
            brightnessResults.push({
              entity: entityId,
              brightness_pct: brightness_pct,
              is_on: state.state === 'on'
            });
          }

          return res.json({
            act,
            result: {
              lights: brightnessResults
            }
          });
        } catch (error) {
          console.error('GET_BRIGHTNESS error:', error);
          return res.status(500).json({ error: error.message });
        }
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