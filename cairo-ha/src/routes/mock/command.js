import { Router } from 'express';
import { parseToAction } from '../../nlp.js';

const router = Router();

// Mock device states
const mockStates = {
  'light.short_lamp': { state: 'off', brightness: 0 },
  'light.tall_lamp': { state: 'off', brightness: 0 },
  'switch.bot1': { state: 'off' },
  'sensor.centralite_3310_g_temperature': { state: '73.4', unit: '°F' },
  'sensor.centralite_3310_g_humidity': { state: '58', unit: '%' },
  'binary_sensor.motion_sensor': { state: 'off', last_changed: new Date().toISOString() }
};

// Mock catalog for NLP
const mockCatalog = {
  capabilities: {
    light: { intents: ['LIGHT_ON', 'LIGHT_OFF', 'LIGHT_SET_BRIGHTNESS', 'LIGHT_TOGGLE'] },
    switch: { intents: ['SWITCH_ON', 'SWITCH_OFF', 'SWITCH_TOGGLE'] },
    sensor: { intents: ['GET_STATE', 'GET_TEMPERATURE', 'GET_HUMIDITY'] },
    binary_sensor: { intents: ['GET_MOTION'] }
  },
  entities: {
    light: [
      { id: 'light.short_lamp', name: 'Short Lamp' },
      { id: 'light.tall_lamp', name: 'Tall Lamp' }
    ],
    switch: [{ id: 'switch.bot1', name: 'Bot 1' }],
    sensor: [
      { id: 'sensor.centralite_3310_g_temperature', name: 'Temperature Sensor' },
      { id: 'sensor.centralite_3310_g_humidity', name: 'Humidity Sensor' }
    ],
    binary_sensor: [{ id: 'binary_sensor.motion_sensor', name: 'Motion Sensor' }]
  }
};

router.post('/intent/parse', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const act = await parseToAction(text, mockCatalog);
  return res.json(act);
});

router.post('/', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });

    let act = await parseToAction(text, mockCatalog);
    
    // Debug logging - show what intent was parsed
    console.log('[MOCK DEBUG] Text:', text);
    console.log('[MOCK DEBUG] Parsed Intent:', JSON.stringify(act, null, 2));
    
    // Same overrides as real command.js
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('temperature') && lowerText.includes('humidity')) {
      console.log('[MOCK] OVERRIDE: Detected combined climate query');
      act = { intent: 'GET_CLIMATE' };
    } else if (lowerText.includes('temperature') && !act.intent?.includes('TEMP')) {
      console.log('[MOCK] OVERRIDE: Detected temperature query');
      act = { intent: 'GET_TEMPERATURE' };
    } else if (lowerText.includes('humidity') && !act.intent?.includes('HUMID')) {
      console.log('[MOCK] OVERRIDE: Detected humidity query');
      act = { intent: 'GET_HUMIDITY' };
    } else if (lowerText.includes('motion') && !act.intent?.includes('MOTION')) {
      console.log('[MOCK] OVERRIDE: Detected motion query');
      act = { intent: 'GET_MOTION' };
    } else if (lowerText.includes('mood') && lowerText.includes('read')) {
      // Reading mode - bright lights
      console.log('[MOCK] OVERRIDE: Converting "reading mood" to 70% brightness');
      act = { 
        intent: 'LIGHT_SET_BRIGHTNESS', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: 70 
      };
    } else if (lowerText.includes('movie')) {
      // Movie mode - dim lights
      console.log('[MOCK] OVERRIDE: Converting "movie mode" to 20% brightness');
      act = { 
        intent: 'LIGHT_SET_BRIGHTNESS', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: 20 
      };
    } else if (lowerText.includes('bedtime') || (lowerText.includes('prepare') && lowerText.includes('bed'))) {
      // Bedtime - lights off
      console.log('[MOCK] OVERRIDE: Converting "bedtime" to lights off');
      act = { 
        intent: 'LIGHT_OFF', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp']
      };
    } else if (lowerText.includes('wake') && (lowerText.includes('house') || lowerText.includes('up'))) {
      // Wake up - everything on
      console.log('[MOCK] OVERRIDE: Converting "wake up" to lights full brightness');
      act = { 
        intent: 'LIGHT_SET_BRIGHTNESS', 
        entity_ids: ['light.short_lamp', 'light.tall_lamp'],
        brightness_pct: 100 
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
      console.log('[MOCK] Greeting or contextual response - passing through');
      return res.json({ 
        act: { intent: 'GREETING_OR_CONTEXT' },
        greeting: isGreeting,
        contextual: isSimpleResponse
      });
    }
    
    // Handle complex scenarios by converting them to actionable intents
    if (act.intent === 'EXPLAIN_UNSUPPORTED' || !act.intent) {
      console.log('[MOCK] Handling complex scenario:', text);
      
      // Convert complex scenarios to specific actions
      if (lowerCmd.includes('mood') && lowerCmd.includes('read')) {
        // Reading mode - bright lights
        console.log('[MOCK] Converting "reading mood" to 70% brightness');
        act = { 
          intent: 'LIGHT_SET_BRIGHTNESS', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp'],
          brightness_pct: 70 
        };
      } else if (lowerCmd.includes('movie') || lowerCmd.includes('film')) {
        // Movie mode - dim lights
        console.log('[MOCK] Converting "movie mode" to 20% brightness');
        act = { 
          intent: 'LIGHT_SET_BRIGHTNESS', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp'],
          brightness_pct: 20 
        };
      } else if (lowerCmd.includes('bedtime') || lowerCmd.includes('sleep')) {
        // Bedtime - lights off or very dim
        console.log('[MOCK] Converting "bedtime" to lights off');
        act = { 
          intent: 'LIGHT_OFF', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp']
        };
      } else if (lowerCmd.includes('wake') && lowerCmd.includes('house')) {
        // Wake up - everything on
        console.log('[MOCK] Converting "wake up house" to lights on full');
        act = { 
          intent: 'LIGHT_SET_BRIGHTNESS', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp'],
          brightness_pct: 100 
        };
      } else if (lowerCmd.includes('everything off') || lowerCmd.includes('all off')) {
        // Everything off
        console.log('[MOCK] Converting "everything off" to lights off');
        act = { 
          intent: 'LIGHT_OFF', 
          entity_ids: ['light.short_lamp', 'light.tall_lamp']
        };
      } else {
        // For truly ambiguous commands, provide suggestions
        console.log('[MOCK] Unclear intent, providing suggestions for:', text);
        
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

    // Mock responses based on intent
    let result;
    switch (act.intent) {
      case 'LIGHT_ON':
        // Update mock state
        if (act.entity_id) {
          mockStates[act.entity_id].state = 'on';
          mockStates[act.entity_id].brightness = 100;
        } else if (act.entity_ids) {
          act.entity_ids.forEach(id => {
            if (mockStates[id]) {
              mockStates[id].state = 'on';
              mockStates[id].brightness = 100;
            }
          });
        }
        result = { success: true };
        break;

      case 'LIGHT_OFF':
        if (act.entity_id) {
          mockStates[act.entity_id].state = 'off';
          mockStates[act.entity_id].brightness = 0;
        } else if (act.entity_ids) {
          act.entity_ids.forEach(id => {
            if (mockStates[id]) {
              mockStates[id].state = 'off';
              mockStates[id].brightness = 0;
            }
          });
        }
        result = { success: true };
        break;

      case 'LIGHT_SET_BRIGHTNESS':
        const brightness = act.brightness_pct || 100;
        if (act.entity_id && mockStates[act.entity_id]) {
          mockStates[act.entity_id].state = 'on';
          mockStates[act.entity_id].brightness = brightness;
        } else if (act.entity_ids) {
          // Handle multiple lights
          act.entity_ids.forEach(id => {
            if (mockStates[id]) {
              mockStates[id].state = 'on';
              mockStates[id].brightness = brightness;
            }
          });
        }
        result = { success: true };
        break;

      case 'LIGHT_TOGGLE':
        if (act.entity_id && mockStates[act.entity_id]) {
          const current = mockStates[act.entity_id].state;
          mockStates[act.entity_id].state = current === 'on' ? 'off' : 'on';
          mockStates[act.entity_id].brightness = current === 'on' ? 0 : 100;
        }
        result = { success: true };
        break;

      case 'SWITCH_ON':
        if (act.entity_id && mockStates[act.entity_id]) {
          mockStates[act.entity_id].state = 'on';
        }
        result = { success: true };
        break;

      case 'SWITCH_OFF':
        if (act.entity_id && mockStates[act.entity_id]) {
          mockStates[act.entity_id].state = 'off';
        }
        result = { success: true };
        break;

      case 'SWITCH_TOGGLE':
        if (act.entity_id && mockStates[act.entity_id]) {
          const current = mockStates[act.entity_id].state;
          mockStates[act.entity_id].state = current === 'on' ? 'off' : 'on';
        }
        result = { success: true };
        break;

      case 'GET_TEMPERATURE':
        const tempSensor = 'sensor.centralite_3310_g_temperature';
        return res.json({
          act,
          result: {
            entity: tempSensor,
            value: mockStates[tempSensor].state,
            unit: mockStates[tempSensor].unit
          }
        });

      case 'GET_HUMIDITY':
        const humidSensor = 'sensor.centralite_3310_g_humidity';
        return res.json({
          act,
          result: {
            entity: humidSensor,
            value: mockStates[humidSensor].state,
            unit: mockStates[humidSensor].unit
          }
        });

      case 'GET_CLIMATE':
        return res.json({
          act,
          result: {
            temperature: {
              value: mockStates['sensor.centralite_3310_g_temperature'].state,
              unit: mockStates['sensor.centralite_3310_g_temperature'].unit,
              entity: 'sensor.centralite_3310_g_temperature'
            },
            humidity: {
              value: mockStates['sensor.centralite_3310_g_humidity'].state,
              unit: mockStates['sensor.centralite_3310_g_humidity'].unit,
              entity: 'sensor.centralite_3310_g_humidity'
            }
          }
        });

      case 'GET_MOTION':
        const motionSensor = 'binary_sensor.motion_sensor';
        // Randomly change motion state for testing
        if (Math.random() > 0.5) {
          mockStates[motionSensor].state = 'on';
          mockStates[motionSensor].last_changed = new Date().toISOString();
        }
        return res.json({
          act,
          result: {
            entity: motionSensor,
            motion: mockStates[motionSensor].state === 'on',
            state: mockStates[motionSensor].state,
            last_changed: mockStates[motionSensor].last_changed
          }
        });

      case 'GET_STATE':
        const entityId = act.entity_id || 'sensor.centralite_3310_g_temperature';
        if (mockStates[entityId]) {
          result = {
            state: mockStates[entityId].state,
            ...mockStates[entityId]
          };
        } else {
          return res.status(404).json({ error: `Entity ${entityId} not found` });
        }
        break;

      default:
        console.log('[MOCK] Unhandled intent:', act.intent);
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
    console.error('[MOCK] Command error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;