import express from 'express';
import { OpenAI } from 'openai';
import axios from 'axios';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Call your own API endpoints safely
const CAIRO_BASE = 'http://localhost:7860';

async function callLocal(path, method='get', body={}) {
  const res = await axios({ method, url: `${CAIRO_BASE}${path}`, data: body });
  return res.data;
}

router.post('/', async (req, res) => {
  const { text, history = [] } = req.body;

  // Optionally gather current state context
  const caps = await callLocal('/capabilities');
  const automations = await callLocal('/automations');

  const system = `
You are Cairo, an intelligent home assistant that can control devices, check sensors,
and manage automations through provided API tools.

If the user asks you to perform something concrete (turn lights, add automation, etc),
return a JSON object:
{"action": {"endpoint": "...", "method": "...", "body": {...}}, "response": "short natural reply"}.

Otherwise, just respond with natural text only.
Never invent endpoints; only use ones shown below.

Available endpoints:
- POST /command {"text":"..."} (general intent)
- GET /state?entity=...
- POST /automations/suggest|diff|apply {"text": "..."} etc.

Capabilities summary: ${JSON.stringify(caps.capabilities).slice(0,800)}...
Currently loaded automations: ${automations.count}
`;

  const rsp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: text }
    ],
    temperature: 0.4
  });

  const msg = rsp.choices[0].message.content.trim();

  // Try to parse possible action
  let parsed;
  try { parsed = JSON.parse(msg); } catch {}

  if (parsed?.action) {
    try {
      const result = await callLocal(
        parsed.action.endpoint,
        parsed.action.method,
        parsed.action.body
      );
      return res.json({ ok: true, result, reply: parsed.response });
    } catch (e) {
      return res.status(400).json({ error: e.message, raw: msg });
    }
  }

  // Normal chat text
  res.json({ reply: msg });
});

export default router;
