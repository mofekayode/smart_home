import { Router } from 'express';
import { suggestAutomationFromText } from '../../nlp.js';

const router = Router();

// In-memory automation storage for testing
let mockAutomations = [
  {
    id: 'automation.mock_1',
    alias: 'Turn on lights when motion detected',
    trigger: {
      platform: 'state',
      entity_id: 'binary_sensor.motion_sensor',
      to: 'on'
    },
    action: {
      service: 'light.turn_on',
      target: { entity_id: ['light.short_lamp', 'light.tall_lamp'] }
    },
    description: 'Turns on all lights when motion is detected'
  }
];

router.get('/', async (_req, res) => {
  res.json({ count: mockAutomations.length, automations: mockAutomations });
});

router.post('/suggest', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  
  // Use real NLP to generate suggestion
  const mockCatalog = {
    entities: {
      light: [
        { id: 'light.short_lamp' },
        { id: 'light.tall_lamp' }
      ],
      switch: [{ id: 'switch.bot1' }],
      sensor: [
        { id: 'sensor.centralite_3310_g_temperature' },
        { id: 'sensor.centralite_3310_g_humidity' }
      ],
      binary_sensor: [{ id: 'binary_sensor.motion_sensor' }]
    }
  };
  
  const proposal = await suggestAutomationFromText(text, mockCatalog);
  
  if (!proposal || !proposal.alias || !proposal.trigger || !proposal.action) {
    return res.status(400).json({ error: 'failed to propose automation', proposal });
  }
  
  // Check for conflicts
  const conflicts = [];
  mockAutomations.forEach(auto => {
    if (auto.alias === proposal.alias) {
      conflicts.push({ type: 'alias', message: `Automation with name "${auto.alias}" already exists` });
    }
    if (auto.id === proposal.id) {
      conflicts.push({ type: 'id', message: `Automation with id "${auto.id}" already exists` });
    }
  });
  
  return res.json({ 
    proposal, 
    conflicts, 
    apply_hint: conflicts.length ? 'update or create_new' : 'create' 
  });
});

router.post('/diff', async (req, res) => {
  const { proposal, mode } = req.body || {};
  if (!proposal) return res.status(400).json({ error: 'proposal required' });
  
  const conflicts = [];
  mockAutomations.forEach(auto => {
    if (auto.alias === proposal.alias || auto.id === proposal.id) {
      conflicts.push({ type: 'alias', auto });
    }
  });
  
  const willMerge = mode === 'update' ? 
    mockAutomations.filter(a => a.alias !== proposal.alias && a.id !== proposal.id).concat(proposal) :
    mockAutomations.concat(proposal);
  
  return res.json({ conflicts, preview_count: willMerge.length });
});

router.post('/apply', async (req, res) => {
  const { proposal, mode } = req.body || {};
  if (!proposal) return res.status(400).json({ error: 'proposal required' });
  
  const conflicts = [];
  const existingIndex = mockAutomations.findIndex(a => 
    a.alias === proposal.alias || a.id === proposal.id
  );
  
  if (existingIndex >= 0) {
    conflicts.push({ type: 'existing', message: 'Automation exists' });
  }
  
  const willUpdate = mode === 'update' || existingIndex >= 0;
  
  if (willUpdate && existingIndex >= 0) {
    // Update existing
    mockAutomations[existingIndex] = proposal;
  } else {
    // Add new
    if (!proposal.id) {
      proposal.id = `automation.mock_${Date.now()}`;
    }
    mockAutomations.push(proposal);
  }
  
  return res.json({ 
    ok: true, 
    reloaded: true, 
    conflicts, 
    mode: willUpdate ? 'update' : 'create',
    backup: 'mock_backup_' + Date.now()
  });
});

router.post('/reload', async (_req, res) => {
  // Mock reload - just return success
  res.json({ reloaded: true });
});

router.delete('/delete', async (req, res) => {
  const { id, alias, keep_only, delete_all } = req.body || {};
  
  const beforeCount = mockAutomations.length;
  
  if (delete_all === true) {
    mockAutomations = [];
  } else if (keep_only) {
    const keepList = Array.isArray(keep_only) ? keep_only : [keep_only];
    mockAutomations = mockAutomations.filter(a => {
      return keepList.some(keep => 
        a.alias && a.alias.toLowerCase().includes(keep.toLowerCase())
      );
    });
  } else {
    if (!id && !alias) return res.status(400).json({ error: 'id, alias, or delete_all required' });
    mockAutomations = mockAutomations.filter(a => {
      if (id && a.id === id) return false;
      if (alias && a.alias === alias) return false;
      return true;
    });
  }
  
  const deleted = beforeCount - mockAutomations.length;
  
  if (deleted === 0 && !keep_only && !delete_all) {
    return res.status(404).json({ error: 'Automation not found' });
  }
  
  return res.json({ 
    ok: true, 
    deleted, 
    remaining: mockAutomations.length,
    kept: keep_only ? mockAutomations.map(a => a.alias || a.id) : null,
    backup: 'mock_backup_' + Date.now()
  });
});

export default router;