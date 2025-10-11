// src/nlp.js
import { OpenAI } from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildSystemPrompt(catalog) {
  const caps = catalog?.capabilities || {};
  const ents = catalog?.entities || {};

  const list = (arr) => (arr && arr.length ? arr.map(e => e.id).join(', ') : 'none');

  return `
You are a command parser for Home Assistant. Return ONLY compact JSON.

Allowed base intents:
LIGHT_ON, LIGHT_OFF, LIGHT_SET_BRIGHTNESS, LIGHT_TOGGLE,
SWITCH_ON, SWITCH_OFF, SWITCH_TOGGLE,
GET_STATE, GET_TEMPERATURE, GET_HUMIDITY, GET_MOTION,
EXPLAIN_UNSUPPORTED

Your current capabilities (live):
Lights intents: ${caps.light?.intents?.join(', ') || 'none'}
Switch intents: ${caps.switch?.intents?.join(', ') || 'none'}
Sensor intents: ${caps.sensor?.intents?.join(', ') || 'none'}
Binary sensor intents: ${caps.binary_sensor?.intents?.join(', ') || 'none'}

Known entities (subset):
Lights: ${list(ents.light)}
Switches: ${list(ents.switch)}
Sensors: ${list(ents.sensor)}
Binary sensors: ${list(ents.binary_sensor)}

Field rules:
brightness_pct is integer 0..100
If a light does not advertise color support do not output rgb_color
If user asks for something you cannot do, return:
{"intent":"EXPLAIN_UNSUPPORTED","reason":"short reason","suggestion":"closest thing you can do"}

Examples:
User: "turn on the short lamp to 40%" -> {"intent":"LIGHT_SET_BRIGHTNESS","entity_id":"light.short_lamp","brightness_pct":40}
User: "turn off both lights" -> {"intent":"LIGHT_OFF","entity_ids":["light.short_lamp","light.tall_lamp"]}
User: "toggle bot1" -> {"intent":"SWITCH_TOGGLE","entity_id":"switch.bot1"}
User: "what is the temperature" -> {"intent":"GET_TEMPERATURE","entity_id":"sensor.centralite_3310_g_temperature"}
User: "make the room purple" (unsupported) -> {"intent":"EXPLAIN_UNSUPPORTED","reason":"no color support","suggestion":"set brightness instead"}
`;
}


// add to src/nlp.js
export async function suggestAutomationFromText(text, catalog) {
  const system = `
You generate a single Home Assistant automation as compact JSON.
Output only JSON. No prose. Fields must match HA schema.

 Rules that MUST be followed:
- For motion, use binary_sensor.* with device_class = motion or occupancy.
- NEVER use sensor.* battery/voltage/power for motion logic.
- "If no motion for X" MUST be a CONDITION on a binary_sensor being "off" with a "for: HH:MM:SS".
- Do NOT add a motion trigger when using a time trigger; use a time trigger plus the "no motion for X" CONDITION.
- All entity_ids MUST exist in the provided catalog.

Required fields:
- alias (string, short)
- id (string kebab or snake, unique-ish)
- description (string, brief)
- trigger (object or array)
- condition (optional, object or array)
- action (object or array)
- mode (optional, e.g. "single")

Use only entities that exist in the catalog. Do not invent ids.
Prefer simple and robust triggers and actions.

Catalog lights (ids):
${(catalog.entities.light || []).map(e => e.id).join(', ')}

Catalog switches:
${(catalog.entities.switch || []).map(e => e.id).join(', ')}

Catalog sensors:
${(catalog.entities.sensor || []).map(e => e.id).join(', ')}
`;

  const rsp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ],
    temperature: 0
  });

  const raw = rsp.choices?.[0]?.message?.content?.trim() || '{}';
  const jsonStr = raw.replace(/```json|```/g, '').trim();
  let obj;
  try { obj = JSON.parse(jsonStr); } catch { obj = {}; }
  return obj;
}

/**
 * parseToAction(text, catalog) -> { intent, entity_id?, entity_ids?, brightness_pct? }
 */
export async function parseToAction(text, catalog) {
  const system = buildSystemPrompt(catalog);

  const rsp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ],
    temperature: 0
  });

  const raw = rsp.choices?.[0]?.message?.content?.trim() || '{}';
  const jsonStr = raw.replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(jsonStr); } catch { parsed = { intent: 'GET_STATE' }; }

  if (parsed.entity_id && parsed.entity_ids) delete parsed.entity_id;
  return parsed;
}
