import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import { parseToAction } from './nlp.js';
import { makeHAClient, buildCatalog } from './capabilities.js';
import {
  loadAutomations, saveAutomations, backupAutomations,
  findConflicts, mergeAutomation
} from './automations.js';
import { suggestAutomationFromText } from './nlp.js';
import chatRouter from './chat.js';

const app = express();
app.use(express.json());
app.use('/chat', chatRouter);

// ---- Home Assistant client ----
const client = axios.create({
  baseURL: `${process.env.HA_URL}/api`,
  headers: {
    Authorization: `Bearer ${process.env.HA_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 8000,
});
const callService = (domain, service, data = {}) =>
  client.post(`/services/${domain}/${service}`, data).then(r => r.data);
const getState = (entity_id) =>
  client.get(`/states/${entity_id}`).then(r => r.data);
const getHistory = async (entity_id, hours = 6) => {
  const since = new Date(Date.now() - Number(hours) * 3600_000).toISOString();
  const { data } = await client.get(`/history/period/${since}`, {
    params: { filter_entity_id: entity_id }
  });
  return data;
};

const haClient = makeHAClient();

let lastCatalog = null;
let lastCatalogAt = 0;

async function getCatalogCached() {
  const now = Date.now();
  if (!lastCatalog || now - lastCatalogAt > 60_000) {
    lastCatalog = await buildCatalog(haClient);
    lastCatalogAt = now;
  }
  return lastCatalog;
}

async function haCheckConfig() {
  const { data } = await client.post('/config/core/check_config');
  return data; // contains result of check
}
async function haReloadAutomations() {
  const { data } = await client.post('/services/automation/reload', {});
  return data;
}


// list current automations
app.get('/automations', async (_req, res) => {
  const autos = await loadAutomations();
  res.json({ count: autos.length, automations: autos });
});

// suggest an automation from natural language
app.post('/automations/suggest', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const catalog = await getCatalogCached();
  const proposal = await suggestAutomationFromText(text, catalog);
  if (!proposal || !proposal.alias || !proposal.trigger || !proposal.action) {
    return res.status(400).json({ error: 'failed to propose automation', proposal });
  }
  const autos = await loadAutomations();
  const conflicts = findConflicts(autos, proposal);
  return res.json({ proposal, conflicts, apply_hint: conflicts.length ? 'update or create_new' : 'create' });
});

// diff and validate a provided automation object
app.post('/automations/diff', async (req, res) => {
  const { proposal, mode } = req.body || {};
  if (!proposal) return res.status(400).json({ error: 'proposal required' });
  const autos = await loadAutomations();
  const conflicts = findConflicts(autos, proposal);
  const merged = mergeAutomation(autos, proposal, mode === 'update' ? 'update' : 'create');
  return res.json({ conflicts, preview_count: merged.length });
});

// apply with backup, config check, reload on success, rollback on failure
app.post('/automations/apply', async (req, res) => {
  const { proposal, mode } = req.body || {};
  if (!proposal) return res.status(400).json({ error: 'proposal required' });

  const autos = await loadAutomations();
  const conflicts = findConflicts(autos, proposal);
  const willUpdate = mode === 'update' || conflicts.some(c => c.type === 'id' || c.type === 'alias');

  const bak = await backupAutomations();
  try {
    const merged = mergeAutomation(autos, proposal, willUpdate ? 'update' : 'create');
    await saveAutomations(merged);

    const check = await haCheckConfig();
    const ok = check?.result === 'valid' || check?.errors === null;
    if (!ok) {
      // rollback
      await fs.copyFile(bak, AUTOMATIONS_PATH);
      return res.status(400).json({ error: 'config check failed', check });
    }

    const reload = await haReloadAutomations();
    return res.json({ ok: true, reloaded: reload, conflicts, mode: willUpdate ? 'update' : 'create', backup: bak });
  } catch (e) {
    // best effort rollback
    try { await fs.copyFile(bak, AUTOMATIONS_PATH); } catch {}
    return res.status(500).json({ error: e.message, backup: bak });
  }
});

// explicit reload endpoint
app.post('/automations/reload', async (_req, res) => {
  const out = await haReloadAutomations();
  res.json({ reloaded: out });
});


app.get('/introspect/entities', async (_req, res) => {
  const cat = await getCatalogCached();
  res.json(cat.entities);
});

app.get('/capabilities', async (_req, res) => {
  const cat = await getCatalogCached();
  res.json(cat);
});

// ---- Health ----
app.get('/health', (_req, res) => res.json({ ok: true }));

// ======================================================
// 3) Lights: brightness + multiple targets
//    - entity can be a single id or a comma-separated list
//    - body supports brightness_pct (0-100), color_temp_kelvin, rgb_color
// ======================================================
app.post('/light/on', async (req, res) => {
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

app.post('/light/off', async (req, res) => {
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

// ======================================================
// 4) SwitchBot (or any switch.*)
// ======================================================
app.post('/switch/on',  async (req, res) => {
  const id = req.query.entity; // e.g. switch.bot1
  if (!id) return res.status(400).json({ error: 'entity required (e.g. switch.bot1)' });
  res.json(await callService('switch', 'turn_on', { entity_id: id }));
});
app.post('/switch/off', async (req, res) => {
  const id = req.query.entity;
  if (!id) return res.status(400).json({ error: 'entity required (e.g. switch.bot1)' });
  res.json(await callService('switch', 'turn_off', { entity_id: id }));
});

// ======================================================
// 5) Read sensors & simple history
// ======================================================
app.get('/state', async (req, res) => {
  const id = req.query.entity;
  if (!id) return res.status(400).json({ error: 'entity required' });
  res.json(await getState(id));
});

app.get('/sensor', async (req, res) => {
  const id = req.query.entity; // e.g. sensor.centralite_3310_g_temperature
  if (!id) return res.status(400).json({ error: 'entity required' });
  const s = await getState(id);
  res.json({
    entity: s.entity_id,
    value: s.state,
    unit: s.attributes.unit_of_measurement || '',
    last_changed: s.last_changed
  });
});

// Quick motion probe
app.get('/motion', async (req, res) => {
  const id = req.query.entity || 'binary_sensor.motion_sensor';
  const s = await getState(id);
  res.json({ entity: s.entity_id, motion: s.state === 'on', state: s.state, last_changed: s.last_changed });
});

// Quick humidity probe
app.get('/humidity', async (req, res) => {
  const id = req.query.entity || 'sensor.centralite_3310_g_humidity';
  const s = await getState(id);
  res.json({ entity: s.entity_id, value: s.state, unit: s.attributes.unit_of_measurement || '%' });
});

app.get('/history', async (req, res) => {
  const id = req.query.entity;
  const hours = req.query.hours || 6;
  if (!id) return res.status(400).json({ error: 'entity required' });
  res.json(await getHistory(id, hours));
});


// add this above the /command route
app.post('/intent/parse', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const act = await parseToAction(text);
  return res.json(act);
});

app.get('/help', async (_req, res) => {
  const cat = await getCatalogCached();
  const out = {
    message: 'I can control lights and switches, and read sensors I can see',
    capabilities: cat.capabilities,
    sample_entities: cat.entities
  };
  res.json(out);
});


const ALLOWED_INTENTS = new Set([
  'LIGHT_ON','LIGHT_OFF','LIGHT_SET_BRIGHTNESS','LIGHT_TOGGLE',
  'SWITCH_ON','SWITCH_OFF','SWITCH_TOGGLE',
  'GET_STATE','GET_TEMPERATURE','GET_HUMIDITY','GET_MOTION',
  'EXPLAIN_UNSUPPORTED'
]);

const ENTITY_RE = /^(light|switch|sensor|binary_sensor|automation|climate|cover)\.[a-z0-9_]+$/;

// Optionally whitelist known entities to avoid hallucinations:
const KNOWN_ENTITIES = new Set([
  'light.short_lamp',
  'light.tall_lamp',
  'switch.bot1',
  'sensor.centralite_3310_g_temperature',
  'sensor.centralite_3310_g_humidity',
  'binary_sensor.motion_sensor'  // replace with your real motion entity id
]);



function normalizeTargets(act) {
  const ids = [];
  if (act.entity_id) ids.push(act.entity_id);
  if (Array.isArray(act.entity_ids)) ids.push(...act.entity_ids);

  // validate format and (optionally) whitelist
  const valid = ids.filter(id => ENTITY_RE.test(id) && (KNOWN_ENTITIES.size ? KNOWN_ENTITIES.has(id) : true));
  return valid.length ? valid : null;
}





// ---- AI-driven command
app.post('/command', async (req, res) => {
  try {
  const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });

    const catalog = await getCatalogCached();
    const act = await parseToAction(text, catalog);

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

    // Execute
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
        const id = act.entity_id && ENTITY_RE.test(act.entity_id) ? act.entity_id
                 : (targets ? targets[0] : 'sensor.centralite_3310_g_temperature');
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
        const id = act.entity_id && ENTITY_RE.test(act.entity_id) ? act.entity_id : 'sensor.centralite_3310_g_temperature';
        const s = await getState(id);
        return res.json({
            act, result: {
            entity: s.entity_id,
            value: s.state,
            unit: s.attributes.unit_of_measurement || ''
            }
        });
        }

        case 'GET_HUMIDITY': {
        const id = act.entity_id && ENTITY_RE.test(act.entity_id) ? act.entity_id : 'sensor.centralite_3310_g_humidity';
        const s = await getState(id);
        return res.json({
            act, result: {
            entity: s.entity_id,
            value: s.state,
            unit: s.attributes.unit_of_measurement || '%'
            }
        });
        }

        case 'GET_MOTION': {
        const id = act.entity_id && ENTITY_RE.test(act.entity_id) ? act.entity_id : 'binary_sensor.motion_sensor';
        const s = await getState(id); // 'on' or 'off'
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

// ---- boot ----
const port = Number(process.env.PORT || 7860);
app.listen(port, () => console.log(`up on http://localhost:${port}`));
