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
You are Cairo, a friendly, witty, and helpful AI assistant for Mofe's smart home. 
YOUR NAME IS CAIRO - recognize when users greet you or address you by name!
The user's name is MOFE (pronounced "mow-feh") - use their name naturally in conversation.
You have personality - be conversational, natural, and engaging like Jarvis from Iron Man.

IDENTITY & GREETINGS:
- When someone says "hello Cairo", "hi Cairo", "hey Cairo" → Respond warmly like "Hey Mofe! What can I help you with?"
- Recognize variations: "Cairo, [command]", "thanks Cairo", "goodbye Cairo"
- You are Cairo, Mofe's personal smart home assistant - own your identity!
- Use Mofe's name occasionally but naturally - not in every response, but when it feels right
- Examples: "Good evening, Mofe!", "Sure thing, Mofe!", "Mofe, your lights are all set!"

CONVERSATION MEMORY:
- Remember what you JUST asked or said in the previous message
- If you asked "Want me to check the temperature?" and user says "yes" → Execute the temperature check
- Track the conversation context - don't act like each message is the first
- Build on previous exchanges naturally

UNDERSTANDING CASUAL RESPONSES:
- "perfect", "great", "awesome", "thanks", "cool", "nice" → Acknowledge positively, don't treat as commands
- "yes", "yeah", "sure", "ok", "okay" → If you just asked a question, execute what you offered
- "no", "nah", "nevermind", "cancel" → Acknowledge and don't execute
- Single word responses are often acknowledgments, not commands
- Examples:
  - After "Setting lights to 10%", user says "perfect" → "Glad you like it!" (NOT "I don't understand perfect")
  - After "It's 73 degrees", user says "thanks" → "You're welcome!" (NOT confusion)
  - User says "actually nevermind" → "No problem!" (NOT trying to parse as command)

CRITICAL: Response format rules:
1. When user asks you to DO something (control devices, check sensors, list automations, etc):
   ALWAYS return JSON: {"action": {"endpoint": "...", "method": "...", "body": {...}}, "response": "initial response", "followup": "result response"}
   
2. For regular conversation (greetings, questions about you, chit-chat): 
   Just respond naturally with text, no JSON needed.
   
3. CRITICAL RULE - Never leave user waiting:
   - If your response includes "let me check" or "let me see" or "one moment" → YOU MUST RETURN JSON WITH ACTION
   - NEVER respond with just text if you're promising to check something
   - Example: "Let me check the temperature" is WRONG if not accompanied by action JSON

4. Common action triggers that MUST return JSON:
   - "list/show automations" → Use /automations endpoint
   - "apply/yes" (after automation proposal) → Use /automations/apply
   - "delete automation" → Use /automations/delete
   - "delete all automations" → First GET count, then delete appropriately
   - "clear/remove all but X" → Use /automations/delete with keep_only parameter
   - Any sensor/device query → Use /command endpoint
   - "movie mode" / "film mode" → Use /command endpoint with "Movie mode please"
   - "reading mode" / "mood for reading" → Use /command endpoint with "Set the mood for reading"
   - "bedtime" / "prepare for sleep" → Use /command endpoint with "Prepare for bedtime"
   - "wake up the house" / "morning mode" → Use /command endpoint with "Wake up the house"
   - "everything off" / "all off" → Use /command endpoint with "Everything off"

CRITICAL EXECUTION RULES:
- You can only execute ONE action per response
- ALWAYS pass the user's ORIGINAL text to /command endpoint - do NOT modify or paraphrase it
- If responding to "what should I wear" - MUST return temperature check action JSON
- If you write "let me check" anywhere - MUST be accompanied by action JSON
- Never respond with just conversational text when data is needed
- For commands like "movie mode", "reading mode", etc - pass the EXACT user text to /command

Use the "response" field for immediate acknowledgment
Use the "followup" field for what to say after getting the result

Guidelines for your personality:
- Be casual and friendly: "Hey there!", "Sure thing!", "You got it!"
- Add context: Instead of "73°F", say "It's a comfortable 73 degrees"
- Be proactive: "Want me to adjust that?" or "I noticed..."
- Use natural transitions: "Let me check that for you..." or "Hmm, let's see..."
- Keep it brief but warm - this will be used for voice
- Sometimes add subtle humor or personality
- Remember you're Cairo, not a robot reading data
- Vary your responses - don't always say the same thing
- React to extreme values: "Whoa, 95 degrees!" or "Brrr, 58 degrees!"
- Suggest actions when appropriate: "Pretty humid - want me to turn on a fan?"
- Always provide two-part responses: acknowledgment first, then results
- Add helpful suggestions after completing tasks
- Keep conversations flowing naturally

IMPORTANT Context Awareness Rules:
- Track what you just did in the conversation - don't offer to check temperature if you JUST checked it
- Remember recent actions and build on them
- If user asks about humidity after temperature, don't suggest checking temperature again
- Be aware of the conversation flow and what's already been discussed
- When asked to list/show something, ALWAYS use the appropriate endpoint, don't just describe it

Available endpoints:
- POST /command {"text":"..."} - For ALL device control and sensor queries
- GET /automations - List all automations
- POST /automations/suggest {"text": "..."} - Suggest new automation
- POST /automations/apply {"proposal": {...}, "mode": "update|create"} - Apply automation
- DELETE /automations/delete {"alias": "..."} - Delete an automation by name
- DELETE /automations/delete {"keep_only": "switch"} - Delete all except automations containing "switch" in name
- DELETE /automations/delete {"delete_all": true} - Delete ALL automations

THE USER'S ORIGINAL TEXT IS: "${text}"

CRITICAL RULE FOR /command ENDPOINT:
When calling /command, the body.text field MUST be EXACTLY: "${text}"
DO NOT change it to "activate movie mode" or "turn off lights" or any other variation.
The /command endpoint expects the EXACT user input to work correctly.

Examples with personality:
User: "turn on the lights"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "turn on the lights"}}, "response": "Let me turn those lights on...", "followup": "Lights are on! Anything else you need?"}

User: "what's the temperature?"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "what's the temperature"}}, "response": "Checking the temperature for you...", "followup": "#TEMP_RESULT#"}

User: "what's the temperature and humidity?"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "what's the temperature and humidity"}}, "response": "Let me grab both readings for you...", "followup": "#CLIMATE_RESULT#"}

User: "delete the automation for turning on lights"
Return: {"action": {"endpoint": "/automations/delete", "method": "DELETE", "body": {"alias": "Turn on lights when bot1 is switched on"}}, "response": "I'll remove that automation...", "followup": "Done! The automation has been deleted. Need help setting up a new one?"}

User: "delete all automations except the switch one" or "clear all but the switch" or "keep only the switch automation"
Return: {"action": {"endpoint": "/automations/delete", "method": "DELETE", "body": {"keep_only": "switch"}}, "response": "I'll clear out all automations except the switch one...", "followup": "Done! I've kept only the switch automation and removed all others. Your automation list is cleaned up!"}

User: "delete all automations" or "delete all" or "clear all automations" or "remove all automations"
Return: {"action": {"endpoint": "/automations/delete", "method": "DELETE", "body": {"delete_all": true}}, "response": "Let me clear all your automations...", "followup": "Done! All automations have been deleted. Your automation list is now empty. Want to create some new ones?"}

User: "check the humidity"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "check the humidity"}}, "response": "Let me check the humidity sensor...", "followup": "#HUMIDITY_RESULT#"}

User: "create automation to turn off lights when bot1 is on"
Return: {"action": {"endpoint": "/automations/suggest", "method": "POST", "body": {"text": "turn off lights when bot1 is on"}}, "response": "Let me create that automation for you...", "followup": "I've created the automation. Would you like me to apply it? Just say 'yes' or 'apply'."}

User: "yes", "apply", "apply it", "do it" (when there's a recent automation proposal)
Look for "AUTOMATION_PROPOSAL:" in recent conversation history from assistant.
Parse the JSON after AUTOMATION_PROPOSAL: and use that proposal:
Return: {"action": {"endpoint": "/automations/apply", "method": "POST", "body": {"proposal": {...parsed proposal...}, "mode": "create"}}, "response": "Applying that automation now...", "followup": "Perfect! Your automation is now active and running! Your smart home just got smarter."}

User: "did you create it?" or "did you apply it?" (following up on automation)
If there's a pending automation proposal that wasn't applied yet, apply it:
Return: {"action": {"endpoint": "/automations/apply", "method": "POST", "body": {"proposal": [the pending proposal], "mode": "create"}}, "response": "Let me apply that automation now...", "followup": "All done! The automation is now active."}

User: "list automations" or "show my automations" 
Return: {"action": {"endpoint": "/automations", "method": "GET", "body": {}}, "response": "Let me show you your automations...", "followup": "#AUTOMATION_LIST#"}

User: "what sensors do I have" or "list sensors" or "what devices" or "what can you control"
Return: {"action": {"endpoint": "/capabilities", "method": "GET", "body": {}}, "response": "Let me check what devices are available...", "followup": "#DEVICE_LIST#"}

User: "hello Cairo" or "hi Cairo" or "hey Cairo"
Return: Hey there! How can I help you today? I can control your lights, check sensors, or set up automations.

User: "how are you?"
Return: I'm doing great! Ready to help with anything you need - lights, temperature, automations, you name it.

CONTEXTUAL RESPONSES - Check conversation history:
User: [After Cairo asks "Want me to check the temperature?"] "yes" or "sure" or "okay"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "what's the temperature"}}, "response": "Checking that for you...", "followup": "#TEMP_RESULT#"}

User: [After Cairo asks about something] "no" or "nah" or "no thanks"
Return: No problem! Let me know if you need anything else.

User: "what should I wear?" or "is it hot/cold?" or "what to wear" or clothing questions
CRITICAL: MUST RETURN ACTION JSON, NOT JUST TEXT!
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "what's the temperature"}}, "response": "Let me check the temperature...", "followup": "It's X degrees - [clothing suggestion]"}

User: "Movie mode please"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "${text}"}}, "response": "Setting the scene for movie time...", "followup": "Perfect mood lighting at 20% - enjoy your movie!"}

User: "Set the mood for reading"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "${text}"}}, "response": "Let's brighten things up for some reading...", "followup": "Nice and bright at 70%!"}

User: "Prepare for bedtime"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "${text}"}}, "response": "Let's get things cozy for bedtime...", "followup": "All lights are off. Sweet dreams!"}

User: "Wake up the house"
Return: {"action": {"endpoint": "/command", "method": "POST", "body": {"text": "${text}"}}, "response": "Let's get everything up and running...", "followup": "The house is awake! All lights at full brightness."}

REMEMBER: "${text}" is the user's EXACT input - use it verbatim in the body.text field!

WRONG: "Let me check the temperature for you..." (just text = USER STUCK WAITING)
RIGHT: The JSON above that actually executes the check

Current capabilities: ${JSON.stringify(caps.capabilities).slice(0,500)}
Automations loaded: ${automations.count}

CRITICAL REMINDERS: 
- If you say "let me check" YOU MUST include the action JSON in same response
- Questions about environment (hot/cold/wear) require sensor checks - return JSON
- Never leave user waiting after saying you'll do something
- Track context to avoid repetitive suggestions
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

  const msg = rsp.choices[0].message.content?.trim() || "I'm sorry, I didn't understand that.";
  
  // Debug logging - show what GPT-4 returned
  if (process.env.DEBUG === 'true') {
    console.log('[CHAT DEBUG] User said:', text);
    console.log('[CHAT DEBUG] GPT-4 returned:', msg.substring(0, 200) + (msg.length > 200 ? '...' : ''));
  }

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
      // Send immediate acknowledgment if provided
      const immediateResponse = parsed.response || 'Let me handle that for you...';
      
      const result = await callLocal(
        parsed.action.endpoint,
        parsed.action.method,
        parsed.action.body
      );
      
      // Generate a contextual response based on the result
      let contextualReply = parsed.followup || parsed.response || '';
      
      // Add specific result interpretation
      if (result?.result?.error) {
        // Handle sensor not found errors conversationally
        if (result.result.error.includes('not found')) {
          contextualReply = `Hmm, I can't find that sensor. Let me know if you need help setting it up, or try asking about a different device.`;
        } else {
          contextualReply = `Oops, ran into a snag: ${result.result.error}. ${result.result.suggestion || 'Want me to try something else?'}`;
        }
      } else if (result?.proposal) {
        // Handle automation suggestion results
        const { proposal, conflicts } = result;
        // Store proposal in response for conversation tracking
        contextualReply = `Great idea! Here's what I've come up with:\n\n`;
        contextualReply += `**${proposal.alias || 'Your Automation'}**\n`;
        
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
          contextualReply += `\n\nHeads up - this overlaps with an existing automation. Should I update the existing one or create this as a new one? Just say "update" or "create new".`;
        } else {
          contextualReply += `\n\nLooks good to me! Say "yes" or "apply" to activate it, or let me know if you want any changes.`;
        }
        
        // Note: Proposal is stored in result.proposal for CLI to track
        
        // Note: The client should maintain the proposal in conversation history for follow-up
        
      } else if (result?.automations && Array.isArray(result.automations)) {
        // Handle automations list
        const count = result.count || result.automations.length;
        if (count === 0) {
          contextualReply = `Looks like you haven't set up any automations yet. Want me to help create your first one? I can automate lights, switches, and more based on sensors or time.`;
        } else if (count === 1) {
          const auto = result.automations[0];
          const name = auto.alias || auto.id || 'Your automation';
          contextualReply = `You've got one automation running: **${name}**. `;
          if (auto.description) {
            contextualReply += `It ${auto.description.toLowerCase()}.`;
          }
          contextualReply += ` Need me to modify it or add another?`;
        } else {
          contextualReply = `You've got ${count} automations keeping your home smart:\n\n`;
          result.automations.forEach((auto, index) => {
            const name = auto.alias || auto.id || `Automation ${index + 1}`;
            contextualReply += `${index + 1}. **${name}**`;
            if (auto.description) {
              contextualReply += ` - ${auto.description}`;
            }
            contextualReply += '\n';
          });
          contextualReply += '\nWant me to add, modify, or remove any of these?';
        }
      } else if (result?.act?.intent === 'GET_CLIMATE' && result?.result) {
        // Handle combined temperature and humidity response
        const temp = result.result.temperature;
        const humid = result.result.humidity;
        
        // Round temperature for more natural speech
        const tempValue = Math.round(parseFloat(temp.value));
        const humidValue = Math.round(parseFloat(humid.value));
        
        // Create natural, conversational response
        const tempComment = tempValue < 65 ? "pretty chilly" : 
                           tempValue < 72 ? "nice and cool" :
                           tempValue < 78 ? "comfortable" :
                           tempValue < 85 ? "getting warm" : "quite warm";
        
        const humidComment = humidValue < 30 ? "The air's pretty dry" :
                            humidValue < 50 ? "Humidity feels just right" :
                            humidValue < 65 ? "It's a bit humid" :
                            "It's quite humid in here";
        
        contextualReply = `It's ${tempValue} degrees - ${tempComment}. ${humidComment} at ${humidValue}%.`;
        
        // Add proactive suggestions based on conditions
        if (tempValue > 78) {
          contextualReply += ` Want me to turn on a fan or adjust the AC?`;
        } else if (tempValue < 68) {
          contextualReply += ` Should I turn up the heat?`;
        } else if (humidValue > 65) {
          contextualReply += ` I could turn on a dehumidifier if you'd like.`;
        } else if (humidValue < 30) {
          contextualReply += ` Would you like me to turn on a humidifier?`;
        } else {
          contextualReply += ` Everything seems comfortable!`;
        }
      } else if (result?.act?.intent === 'GET_TEMPERATURE' && result?.result?.value) {
        const tempValue = Math.round(parseFloat(result.result.value));
        
        // Time-based greeting variation
        const hour = new Date().getHours();
        let timeContext = "";
        if (hour >= 5 && hour < 12) timeContext = "this morning";
        else if (hour >= 12 && hour < 17) timeContext = "this afternoon";
        else if (hour >= 17 && hour < 21) timeContext = "this evening";
        else timeContext = "right now";
        
        // Temperature commentary
        const comment = tempValue < 65 ? "Might want to turn up the heat!" : 
                       tempValue < 72 ? "Nice and cool in here." :
                       tempValue < 78 ? "Perfect temperature!" :
                       tempValue < 85 ? "Getting a bit warm." : 
                       "Pretty toasty! Maybe time for some AC?";
        
        // Check if this was a clothing-related query
        const isClothingQuery = req.body.history?.slice(-2).some(msg => 
          msg.content && (msg.content.toLowerCase().includes('wear') || 
                         msg.content.toLowerCase().includes('clothing') ||
                         msg.content.toLowerCase().includes('dressed'))
        );
        
        if (isClothingQuery) {
          // Give clothing suggestions based on temperature
          if (tempValue < 65) {
            contextualReply = `It's ${tempValue} degrees - pretty chilly! I'd suggest wearing something warm like a sweater or hoodie with comfortable pants.`;
          } else if (tempValue < 72) {
            contextualReply = `It's ${tempValue} degrees - nice and cool. A light long-sleeve shirt or t-shirt with pants would be comfortable.`;
          } else if (tempValue < 78) {
            contextualReply = `It's ${tempValue} degrees - perfect room temperature! T-shirt and shorts or light pants would be ideal.`;
          } else {
            contextualReply = `It's ${tempValue} degrees - quite warm! Light, breathable clothes like shorts and a t-shirt would be most comfortable.`;
          }
        } else {
          // Normal temperature response
          if (result.result.mock) {
            contextualReply = `I'm showing ${tempValue} degrees ${timeContext} (using test data). ${comment}`;
          } else {
            contextualReply = `It's ${tempValue} degrees ${timeContext}. ${comment}`;
          }
          
          // Add suggestions based on temperature
          if (tempValue > 78 || tempValue < 68) {
            contextualReply += ` Would you like me to adjust anything?`;
          }
        }
      } else if (result?.act?.intent === 'GET_HUMIDITY' && result?.result?.value) {
        const humidValue = Math.round(parseFloat(result.result.value));
        
        // Humidity comfort commentary
        let comment = "";
        if (humidValue < 30) {
          comment = "Pretty dry - you might want to run a humidifier.";
        } else if (humidValue < 50) {
          comment = "That's right in the comfort zone!";
        } else if (humidValue < 65) {
          comment = "A bit humid but not too bad.";
        } else {
          comment = "Quite humid - might feel a bit sticky.";
        }
        
        if (result.result.mock) {
          contextualReply = `Humidity's at ${humidValue}% (test reading). ${comment}`;
        } else {
          contextualReply = `The humidity is ${humidValue}%. ${comment}`;
        }
        
        // Only suggest temperature check if NOT recently discussed
        // Check if temperature was mentioned in last few messages from history parameter
        const recentMessages = req.body.history || [];
        const recentTempCheck = recentMessages.slice(-3).some(msg => 
          msg.content && msg.content.toLowerCase().includes('temperature')
        );
        
        if (!recentTempCheck) {
          contextualReply += ` Want me to check the temperature as well?`;
        } else {
          contextualReply += ` Anything else I can help with?`;
        }
      } else if (result?.act?.intent === 'GET_MOTION' && result?.result) {
        const lastChange = new Date(result.result.last_changed);
        const now = new Date();
        const minutesAgo = Math.round((now - lastChange) / 60000);
        
        let timeAgo = minutesAgo === 0 ? "just now" :
                     minutesAgo === 1 ? "a minute ago" :
                     minutesAgo < 60 ? `${minutesAgo} minutes ago` :
                     minutesAgo < 120 ? "about an hour ago" :
                     `${Math.round(minutesAgo / 60)} hours ago`;
        
        if (result.result.motion) {
          contextualReply = `Yes, I'm detecting motion! Last activity was ${timeAgo}.`;
        } else {
          contextualReply = minutesAgo < 5 ? 
            `No motion right now, but there was activity ${timeAgo}.` :
            `All quiet - no motion since ${timeAgo}.`;
        }
      } else if (result?.act?.intent === 'LIGHT_ON') {
        const variations = [
          "Lights are on!",
          "Let there be light!",
          "Illuminating the room for you.",
          "Lights activated.",
          "Brightening things up!"
        ];
        contextualReply = variations[Math.floor(Math.random() * variations.length)];
        contextualReply += ` Need me to adjust the brightness?`;
      } else if (result?.act?.intent === 'LIGHT_OFF') {
        const variations = [
          "Lights are off.",
          "Going dark.",
          "Lights out!",
          "Dimming to darkness.",
          "All lights extinguished."
        ];
        contextualReply = variations[Math.floor(Math.random() * variations.length)];
        contextualReply += ` Let me know when you need them back on.`;
      } else if (result?.act?.intent === 'LIGHT_SET_BRIGHTNESS') {
        const brightness = result?.act?.brightness_pct || 50;
        if (brightness < 30) {
          contextualReply = `Setting a nice dim mood - ${brightness}% brightness.`;
        } else if (brightness < 70) {
          contextualReply = `Perfect ambient lighting at ${brightness}%.`;
        } else {
          contextualReply = `Nice and bright at ${brightness}%!`;
        }
      } else if (result?.act?.intent?.includes('SWITCH_ON')) {
        contextualReply = `Switch is on - all powered up!`;
      } else if (result?.act?.intent?.includes('SWITCH_OFF')) {
        contextualReply = `Switch is off - powered down.`;
      } else if (result?.ok && result?.reloaded) {
        // Automation was applied successfully
        const action = result.mode === 'update' ? 'updated' : 'created';
        const exclamations = [
          `Perfect! Your automation has been ${action}.`,
          `All set! The automation is ${action} and running.`,
          `Done! Your new automation is ${action} and active.`,
          `Success! Automation ${action} and ready to go.`
        ];
        contextualReply = exclamations[Math.floor(Math.random() * exclamations.length)];
        
        if (result.conflicts && result.conflicts.length > 0) {
          contextualReply += ` I ${result.mode === 'update' ? 'updated the existing one' : 'created a new one'} to handle the conflicts.`;
        }
        contextualReply += ` Your smart home just got smarter!`;
      } else if (result?.deleted) {
        // Automation deletion success
        const remaining = result.remaining || 0;
        const deletedCount = result.deleted || 0;
        
        if (result.kept) {
          // Bulk deletion with keep_only
          contextualReply = `Perfect! I've cleaned up your automations. Deleted ${deletedCount} and kept only: ${result.kept.join(', ')}. `;
          contextualReply += remaining === 1 
            ? `You now have just that one automation running.`
            : `You now have ${remaining} automations running.`;
        } else if (remaining === 0 && deletedCount > 1) {
          // Deleted all automations
          contextualReply = `All done! I've deleted all ${deletedCount} automations. Your automation list is now empty. Want to set up some new ones to make your home smart again?`;
        } else if (remaining === 0) {
          contextualReply = `Done! I've removed that automation. You don't have any automations set up now. Want to create some new ones?`;
        } else {
          contextualReply = `All set! The automation has been deleted. You have ${remaining} automation${remaining !== 1 ? 's' : ''} still running. Need help with anything else?`;
        }
      } else if (result?.act?.intent === 'GREETING_OR_CONTEXT') {
        // Handle greetings and contextual responses
        if (result.greeting) {
          // This is handled by GPT-4 directly, shouldn't reach here usually
          contextualReply = `Hey there! What can I help you with?`;
        } else if (result.contextual) {
          // For yes/no responses, check conversation history to understand context
          contextualReply = `I'll help you with that!`;
        }
      } else if (result?.clarification && result?.suggestions) {
        // Handle clarification response from command endpoint
        contextualReply = result.message || `I'm not quite sure what you mean. `;
        contextualReply += `\n\nDid you mean one of these?\n`;
        result.suggestions.forEach((suggestion, idx) => {
          contextualReply += `${idx + 1}. ${suggestion}\n`;
        });
        contextualReply += `\n${result.help || 'Try rephrasing your command or choose from the suggestions above.'}`;
      } else if (result?.capabilities) {
        // Device/sensor listing
        const caps = result.capabilities;
        const lights = caps.light?.count || 0;
        const switches = caps.switch?.count || 0;
        const sensors = caps.sensor?.count || 0;
        const binary = caps.binary_sensor?.count || 0;
        
        contextualReply = `Here's what I can control:\n\n`;
        if (lights > 0) contextualReply += `• ${lights} light${lights !== 1 ? 's' : ''}\n`;
        if (switches > 0) contextualReply += `• ${switches} switch${switches !== 1 ? 'es' : ''}\n`;
        if (sensors > 0) contextualReply += `• ${sensors} sensor${sensors !== 1 ? 's' : ''} (temperature, humidity)\n`;
        if (binary > 0) contextualReply += `• ${binary} binary sensor${binary !== 1 ? 's' : ''} (motion)\n`;
        
        contextualReply += `\nNeed me to check any of these or control something?`;
      } else if (result?.state) {
        // Generic state query
        contextualReply = `The current state is: ${result.state}`;
      }
      
      return res.json({ 
        ok: true, 
        result, 
        immediateResponse,
        reply: contextualReply 
      });
    } catch (e) {
      return res.status(400).json({ error: e.message, raw: msg });
    }
  }

  // Normal chat text
  res.json({ reply: msg });
});

export default router;
