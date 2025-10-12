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

If the user asks you to perform something concrete (turn lights, check sensors, etc),
return ONLY a valid JSON object with no additional text:
{"action": {"endpoint": "...", "method": "...", "body": {...}}, "response": "short natural reply"}

For conversations that don't require actions, respond with natural text only.
Never invent endpoints; only use ones shown below.

Available endpoints:
- POST /command {"text":"..."} - For ALL device control and sensor queries (USE THIS FOR TEMPERATURE, HUMIDITY, LIGHTS, ETC)
- GET /automations - List all automations
- POST /automations/suggest {"text": "..."} - Suggest new automation (returns proposal with details)
- POST /automations/apply {"proposal": {...}, "mode": "update|create"} - Apply automation

IMPORTANT: Always use /command endpoint for device control and sensor queries. Never use /state directly.

Examples:
User: "turn on the lights"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "turn on the lights"}}, "response": "Turning on the lights for you."}

User: "what's the temperature?"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "what's the temperature"}}, "response": "Let me check the temperature for you."}

User: "check the humidity"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "check the humidity"}}, "response": "Let me check the humidity for you."}

User: "create automation to turn off lights when bot1 is on"
Return: {"action": {"endpoint": "/automations/suggest", "method": "POST", "body": {"text": "turn off lights when bot1 is on"}}, "response": "Let me create that automation for you."}

User: "yes" or "apply it" (when there's a recent automation proposal in conversation)
Look for "Last automation proposal:" in the conversation history, then:
Return: {"action": {"endpoint": "/automations/apply", "method": "POST", "body": {"proposal": [the proposal object], "mode": "create"}}, "response": "Applying the automation now."}

User: "how are you?"
Return: I'm doing well, thank you! I'm here to help with your smart home.

Capabilities: ${JSON.stringify(caps.capabilities).slice(0,500)}
Automations loaded: ${automations.count}
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
  
  // First try direct JSON parse
  try { 
    parsed = JSON.parse(msg); 
  } catch {
    // Try to extract JSON from the message
    const jsonMatch = msg.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (jsonMatch) {
      try { 
        parsed = JSON.parse(jsonMatch[0]); 
      } catch {}
    }
  }

  if (parsed?.action) {
    try {
      const result = await callLocal(
        parsed.action.endpoint,
        parsed.action.method,
        parsed.action.body
      );
      
      // Generate a contextual response based on the result
      let contextualReply = parsed.response || '';
      
      // Add specific result interpretation
      if (result?.result?.error) {
        // Handle sensor not found errors
        contextualReply = `⚠️ ${result.result.error}\n\n${result.result.suggestion || 'Please check your Home Assistant configuration.'}`;
      } else if (result?.proposal) {
        // Handle automation suggestion results
        const { proposal, conflicts, apply_hint } = result;
        contextualReply = `I've created an automation suggestion for you:\n\n`;
        contextualReply += `**Name:** ${proposal.alias || 'Unnamed Automation'}\n`;
        
        if (proposal.description) {
          contextualReply += `**Description:** ${proposal.description}\n`;
        }
        
        // Describe triggers
        contextualReply += `\n**When:** `;
        if (Array.isArray(proposal.trigger)) {
          contextualReply += proposal.trigger.map(t => {
            if (t.platform === 'state' && t.entity_id) {
              return `${t.entity_id} changes to ${t.to || 'any state'}`;
            }
            return JSON.stringify(t);
          }).join(' OR ');
        } else if (proposal.trigger) {
          if (proposal.trigger.platform === 'state' && proposal.trigger.entity_id) {
            contextualReply += `${proposal.trigger.entity_id} changes to ${proposal.trigger.to || 'any state'}`;
          } else {
            contextualReply += JSON.stringify(proposal.trigger);
          }
        }
        
        // Describe actions
        contextualReply += `\n**Then:** `;
        if (Array.isArray(proposal.action)) {
          contextualReply += proposal.action.map(a => {
            if (a.service) {
              return `${a.service} ${a.target?.entity_id || a.entity_id || ''}`;
            }
            return JSON.stringify(a);
          }).join(', then ');
        } else if (proposal.action) {
          if (proposal.action.service) {
            contextualReply += `${proposal.action.service} ${proposal.action.target?.entity_id || proposal.action.entity_id || ''}`;
          } else {
            contextualReply += JSON.stringify(proposal.action);
          }
        }
        
        // Handle conflicts
        if (conflicts && conflicts.length > 0) {
          contextualReply += `\n\n⚠️ **Note:** This automation has conflicts with existing ones:\n`;
          conflicts.forEach(c => {
            contextualReply += `- ${c.type}: ${c.message || JSON.stringify(c)}\n`;
          });
          contextualReply += `\nWould you like me to update the existing automation or create a new one?`;
        } else {
          contextualReply += `\n\nWould you like me to apply this automation? Just say "yes" or "apply it".`;
        }
        
        // Note: The client should maintain the proposal in conversation history for follow-up
        
      } else if (result?.automations && Array.isArray(result.automations)) {
        // Handle automations list
        const count = result.count || result.automations.length;
        if (count === 0) {
          contextualReply = `You don't have any automations set up yet. Would you like me to help you create one?`;
        } else {
          contextualReply = `You have ${count} automation${count !== 1 ? 's' : ''} configured:\n\n`;
          result.automations.forEach((auto, index) => {
            const name = auto.alias || auto.id || `Automation ${index + 1}`;
            const triggers = auto.trigger ? (Array.isArray(auto.trigger) ? auto.trigger.length : 1) : 0;
            const actions = auto.action ? (Array.isArray(auto.action) ? auto.action.length : 1) : 0;
            contextualReply += `${index + 1}. **${name}**\n`;
            contextualReply += `   - Triggers: ${triggers} trigger${triggers !== 1 ? 's' : ''}\n`;
            contextualReply += `   - Actions: ${actions} action${actions !== 1 ? 's' : ''}\n`;
            if (auto.description) {
              contextualReply += `   - Description: ${auto.description}\n`;
            }
            contextualReply += '\n';
          });
        }
      } else if (result?.act?.intent === 'GET_TEMPERATURE' && result?.result?.value) {
        if (result.result.mock) {
          contextualReply = `The temperature reading is ${result.result.value}${result.result.unit} (Note: ${result.result.message}).`;
        } else {
          contextualReply = `The temperature is currently ${result.result.value}°${result.result.unit || 'F'}.`;
        }
      } else if (result?.act?.intent === 'GET_HUMIDITY' && result?.result?.value) {
        if (result.result.mock) {
          contextualReply = `The humidity reading is ${result.result.value}${result.result.unit} (Note: ${result.result.message}).`;
        } else {
          contextualReply = `The humidity is ${result.result.value}${result.result.unit || '%'}.`;
        }
      } else if (result?.act?.intent === 'GET_MOTION' && result?.result) {
        contextualReply = result.result.motion 
          ? `Motion detected! Last activity was ${new Date(result.result.last_changed).toLocaleString()}.`
          : `No motion detected. Last activity was ${new Date(result.result.last_changed).toLocaleString()}.`;
      } else if (result?.act?.intent === 'LIGHT_ON') {
        contextualReply = `I've turned on the lights for you.`;
      } else if (result?.act?.intent === 'LIGHT_OFF') {
        contextualReply = `I've turned off the lights.`;
      } else if (result?.act?.intent === 'LIGHT_SET_BRIGHTNESS') {
        contextualReply = `I've adjusted the brightness as requested.`;
      } else if (result?.act?.intent?.includes('SWITCH_ON')) {
        contextualReply = `The switch has been turned on.`;
      } else if (result?.act?.intent?.includes('SWITCH_OFF')) {
        contextualReply = `The switch has been turned off.`;
      } else if (result?.ok && result?.reloaded) {
        // Automation was applied successfully
        contextualReply = `✅ Automation successfully ${result.mode === 'update' ? 'updated' : 'created'} and activated! Home Assistant has reloaded the automations.`;
        if (result.conflicts && result.conflicts.length > 0) {
          contextualReply += `\n\nResolved ${result.conflicts.length} conflict(s) by ${result.mode === 'update' ? 'updating' : 'creating new'}.`;
        }
      } else if (result?.state) {
        // Generic state query
        contextualReply = `The current state is: ${result.state}`;
      }
      
      return res.json({ ok: true, result, reply: contextualReply });
    } catch (e) {
      return res.status(400).json({ error: e.message, raw: msg });
    }
  }

  // Normal chat text
  res.json({ reply: msg });
});

export default router;
