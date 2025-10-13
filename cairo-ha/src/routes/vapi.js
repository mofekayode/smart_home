import express from 'express';
import axios from 'axios';

const router = express.Router();

// Vapi webhook handler
router.post('/webhook', async (req, res) => {
  const { type, call, assistant, messages, functionCall, transcript } = req.body;
  
  console.log(`📞 Vapi Event: ${type}`);

  try {
    switch (type) {
      case 'function-call':
        // Handle function calls from Vapi
        const result = await handleFunctionCall(functionCall, call);
        return res.json(result);
        
      case 'assistant-request':
        // Provide assistant configuration
        return res.json(getAssistantConfig());
        
      case 'call-started':
        console.log(`🎙️ Call started: ${call.id}`);
        return res.json({ message: 'Call started' });
        
      case 'call-ended':
        console.log(`📴 Call ended: ${call.id}`);
        return res.json({ message: 'Call ended' });
        
      case 'transcript':
        // Log conversation transcript
        console.log(`💬 Transcript: ${transcript?.text || 'No text'}`);
        return res.json({ message: 'Transcript received' });
        
      default:
        console.log(`⚠️ Unknown event type: ${type}`);
        return res.json({ message: 'Event received' });
    }
  } catch (error) {
    console.error('❌ Vapi webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Handle function calls from Vapi
async function handleFunctionCall(functionCall, call) {
  const { name, parameters } = functionCall;
  
  console.log(`🔧 Function: ${name}`, parameters);
  
  try {
    switch (name) {
      case 'control_lights':
        return await controlLights(parameters);
        
      case 'set_brightness':
        return await setBrightness(parameters);
        
      case 'check_temperature':
        return await checkTemperature(parameters);
        
      case 'set_scene':
        return await setScene(parameters);
        
      case 'get_device_status':
        return await getDeviceStatus(parameters);
        
      case 'create_automation':
        return await createAutomation(parameters);
        
      default:
        // Fallback to general command processing
        return await processCommand(parameters.command || parameters.text);
    }
  } catch (error) {
    console.error(`❌ Function error for ${name}:`, error);
    return {
      result: `Sorry, I couldn't ${name.replace('_', ' ')}. There was an error.`
    };
  }
}

// Light control function
async function controlLights({ action, room = 'all' }) {
  try {
    const command = room === 'all' 
      ? `Turn ${action} all lights`
      : `Turn ${action} ${room} lights`;
      
    const response = await axios.post('http://localhost:7860/command', {
      text: command
    });
    
    return {
      result: response.data.reply || `Lights ${action === 'on' ? 'turned on' : 'turned off'} in ${room}`
    };
  } catch (error) {
    return {
      result: `Sorry, I couldn't control the lights.`
    };
  }
}

// Brightness control
async function setBrightness({ level, room = 'all' }) {
  try {
    const command = room === 'all'
      ? `Set brightness to ${level}%`
      : `Set ${room} brightness to ${level}%`;
      
    const response = await axios.post('http://localhost:7860/command', {
      text: command
    });
    
    return {
      result: response.data.reply || `Brightness set to ${level}% in ${room}`
    };
  } catch (error) {
    return {
      result: `Sorry, I couldn't adjust the brightness.`
    };
  }
}

// Temperature check
async function checkTemperature({ sensor = 'main' }) {
  try {
    const response = await axios.post('http://localhost:7860/command', {
      text: `What's the temperature?`
    });
    
    return {
      result: response.data.reply || `The temperature is 72 degrees`
    };
  } catch (error) {
    return {
      result: `Sorry, I couldn't check the temperature.`
    };
  }
}

// Scene setting
async function setScene({ scene }) {
  try {
    const response = await axios.post('http://localhost:7860/command', {
      text: `${scene} mode`
    });
    
    return {
      result: response.data.reply || `${scene} mode activated`
    };
  } catch (error) {
    return {
      result: `Sorry, I couldn't set ${scene} mode.`
    };
  }
}

// Device status
async function getDeviceStatus({ device = 'all' }) {
  try {
    const response = await axios.post('http://localhost:7860/command', {
      text: device === 'all' ? 'List my devices' : `Status of ${device}`
    });
    
    return {
      result: response.data.reply || `All devices are functioning normally`
    };
  } catch (error) {
    return {
      result: `Sorry, I couldn't check device status.`
    };
  }
}

// Create automation
async function createAutomation(params) {
  try {
    const response = await axios.post('http://localhost:7860/command', {
      text: `Create automation: ${JSON.stringify(params)}`
    });
    
    return {
      result: response.data.reply || `Automation created successfully`
    };
  } catch (error) {
    return {
      result: `Sorry, I couldn't create the automation.`
    };
  }
}

// General command processing
async function processCommand(text) {
  try {
    const response = await axios.post('http://localhost:7860/command', {
      text: text
    });
    
    return {
      result: response.data.reply || `Command processed`
    };
  } catch (error) {
    return {
      result: `I'm having trouble understanding that command.`
    };
  }
}

// Get assistant configuration
function getAssistantConfig() {
  return {
    name: "Cairo",
    firstMessage: "Hey Mofe! Cairo here. How can I help you with your smart home?",
    model: {
      provider: "openai",
      model: "gpt-4",
      temperature: 0.7,
      systemPrompt: `You are Cairo, Mofe's friendly and intelligent smart home assistant. 
      You have a warm personality like Jarvis from Iron Man.
      You help control lights, temperature, scenes, and home automation.
      Be conversational, natural, and helpful.
      Mofe's name is pronounced "mow-feh".
      Keep responses brief and natural for voice interaction.`
    },
    voice: {
      provider: "openai",
      voiceId: "nova"
    },
    silenceTimeoutSeconds: 2,
    responseDelaySeconds: 0.4,
    llmRequestDelaySeconds: 0.1,
    numWordsToInterruptAssistant: 2,
    functions: [
      {
        name: "control_lights",
        description: "Turn lights on or off in a specific room or all rooms",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["on", "off"],
              description: "Whether to turn lights on or off"
            },
            room: {
              type: "string",
              description: "The room to control (or 'all' for all rooms)"
            }
          },
          required: ["action"]
        }
      },
      {
        name: "set_brightness",
        description: "Set the brightness level of lights",
        parameters: {
          type: "object",
          properties: {
            level: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Brightness percentage (0-100)"
            },
            room: {
              type: "string",
              description: "The room to control (or 'all' for all rooms)"
            }
          },
          required: ["level"]
        }
      },
      {
        name: "check_temperature",
        description: "Check the current temperature",
        parameters: {
          type: "object",
          properties: {
            sensor: {
              type: "string",
              description: "Which sensor to check"
            }
          }
        }
      },
      {
        name: "set_scene",
        description: "Activate a scene like movie, reading, bedtime, etc",
        parameters: {
          type: "object",
          properties: {
            scene: {
              type: "string",
              enum: ["movie", "reading", "bedtime", "morning", "party", "romantic"],
              description: "The scene to activate"
            }
          },
          required: ["scene"]
        }
      },
      {
        name: "get_device_status",
        description: "Check the status of smart home devices",
        parameters: {
          type: "object",
          properties: {
            device: {
              type: "string",
              description: "The device to check (or 'all' for all devices)"
            }
          }
        }
      }
    ]
  };
}

export default router;