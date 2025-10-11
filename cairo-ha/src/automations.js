// src/automations.js
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

export const AUTOMATIONS_PATH = process.env.AUTOMATIONS_PATH
  || '/home/mofe/smartbrain/ha_config/automations.yaml';

function assertWhitelisted(p) {
  const allowed = path.normalize(AUTOMATIONS_PATH);
  const got = path.normalize(p);
  if (got !== allowed) throw new Error('path not allowed');
}

export async function loadAutomations() {
  assertWhitelisted(AUTOMATIONS_PATH);
  try {
    const txt = await fs.readFile(AUTOMATIONS_PATH, 'utf8');
    const data = yaml.load(txt) || [];
    if (!Array.isArray(data)) throw new Error('automations.yaml must be a YAML list');
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export async function saveAutomations(autos) {
  assertWhitelisted(AUTOMATIONS_PATH);
  const txt = yaml.dump(autos, { noRefs: true, lineWidth: 120 });
  await fs.writeFile(AUTOMATIONS_PATH, txt, 'utf8');
}

export async function backupAutomations() {
  assertWhitelisted(AUTOMATIONS_PATH);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${AUTOMATIONS_PATH}.${ts}.bak`;
  const txt = await fs.readFile(AUTOMATIONS_PATH, 'utf8').catch(() => '');
  await fs.writeFile(bak, txt, 'utf8');
  return bak;
}

// naive conflict pass
export function findConflicts(existing, proposed) {
  const conflicts = [];
  const pAlias = (proposed.alias || '').toLowerCase();
  const pId = proposed.id || null;

  // 1) direct alias or id match
  for (const a of existing) {
    if (pId && a.id && a.id === pId) {
      conflicts.push({ type: 'id', with: a.id });
    }
    const aAlias = (a.alias || '').toLowerCase();
    if (pAlias && aAlias && aAlias === pAlias) {
      conflicts.push({ type: 'alias', with: a.alias });
    }
  }

  // 2) overlap on same trigger entity and domain
  const pTriggers = Array.isArray(proposed.trigger) ? proposed.trigger : (proposed.trigger ? [proposed.trigger] : []);
  for (const a of existing) {
    const aTriggers = Array.isArray(a.trigger) ? a.trigger : (a.trigger ? [a.trigger] : []);
    for (const pt of pTriggers) {
      for (const at of aTriggers) {
        if (pt && at) {
          const sameEntity = pt.entity_id && at.entity_id && pt.entity_id === at.entity_id;
          const sameType = pt.platform && at.platform && pt.platform === at.platform;
          if (sameEntity && sameType) {
            conflicts.push({ type: 'trigger_overlap', with: a.alias || a.id || 'unknown' });
          }
        }
      }
    }
  }
  return dedupe(conflicts);
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const c of arr) {
    const k = `${c.type}:${c.with}`;
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}

export function mergeAutomation(existing, proposed, mode) {
  // mode: "create" or "update"
  if (mode === 'create') {
    return [...existing, proposed];
  }
  if (mode === 'update') {
    // update by id if present, else by alias, else append
    if (proposed.id) {
      const idx = existing.findIndex(a => a.id === proposed.id);
      if (idx >= 0) {
        const copy = existing.slice();
        copy[idx] = { ...existing[idx], ...proposed };
        return copy;
      }
    }
    if (proposed.alias) {
      const idx = existing.findIndex(a => (a.alias || '').toLowerCase() === proposed.alias.toLowerCase());
      if (idx >= 0) {
        const copy = existing.slice();
        copy[idx] = { ...existing[idx], ...proposed };
        return copy;
      }
    }
    return [...existing, proposed];
  }
  throw new Error('unknown merge mode');
}
