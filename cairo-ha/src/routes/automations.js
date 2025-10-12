import { Router } from 'express';
import fs from 'fs/promises';
import { getCatalogCached } from '../catalogService.js';
import { haCheckConfig, haReloadAutomations } from '../homeAssistantClient.js';
import {
  loadAutomations, saveAutomations, backupAutomations,
  findConflicts, mergeAutomation, AUTOMATIONS_PATH
} from '../automations.js';
import { suggestAutomationFromText } from '../nlp.js';

const router = Router();

router.get('/', async (_req, res) => {
  const autos = await loadAutomations();
  res.json({ count: autos.length, automations: autos });
});

router.post('/suggest', async (req, res) => {
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

router.post('/diff', async (req, res) => {
  const { proposal, mode } = req.body || {};
  if (!proposal) return res.status(400).json({ error: 'proposal required' });
  const autos = await loadAutomations();
  const conflicts = findConflicts(autos, proposal);
  const merged = mergeAutomation(autos, proposal, mode === 'update' ? 'update' : 'create');
  return res.json({ conflicts, preview_count: merged.length });
});

router.post('/apply', async (req, res) => {
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
      await fs.copyFile(bak, AUTOMATIONS_PATH);
      return res.status(400).json({ error: 'config check failed', check });
    }

    const reload = await haReloadAutomations();
    return res.json({ ok: true, reloaded: reload, conflicts, mode: willUpdate ? 'update' : 'create', backup: bak });
  } catch (e) {
    try { await fs.copyFile(bak, AUTOMATIONS_PATH); } catch {}
    return res.status(500).json({ error: e.message, backup: bak });
  }
});

router.post('/reload', async (_req, res) => {
  const out = await haReloadAutomations();
  res.json({ reloaded: out });
});

router.delete('/delete', async (req, res) => {
  const { id, alias, keep_only, delete_all } = req.body || {};
  
  const bak = await backupAutomations();
  try {
    const autos = await loadAutomations();
    let filtered;
    
    if (delete_all === true) {
      // Delete all automations
      filtered = [];
    } else if (keep_only) {
      // Keep only automations with specified aliases
      const keepList = Array.isArray(keep_only) ? keep_only : [keep_only];
      filtered = autos.filter(a => {
        return keepList.some(keep => 
          a.alias && a.alias.toLowerCase().includes(keep.toLowerCase())
        );
      });
    } else {
      // Delete specific automation
      if (!id && !alias) return res.status(400).json({ error: 'id, alias, or delete_all required' });
      filtered = autos.filter(a => {
        if (id && a.id === id) return false;
        if (alias && a.alias === alias) return false;
        return true;
      });
    }
    
    if (filtered.length === autos.length && !keep_only && !delete_all) {
      return res.status(404).json({ error: 'Automation not found' });
    }
    
    await saveAutomations(filtered);
    await haReloadAutomations();
    
    const deleted = autos.length - filtered.length;
    return res.json({ 
      ok: true, 
      deleted, 
      remaining: filtered.length,
      kept: keep_only ? filtered.map(a => a.alias || a.id) : null,
      backup: bak 
    });
  } catch (e) {
    try { await fs.copyFile(bak, AUTOMATIONS_PATH); } catch {}
    return res.status(500).json({ error: e.message, backup: bak });
  }
});

export default router;