#!/usr/bin/env node

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';

const VAPI_API_KEY = process.env.VAPI_PRIVATE_KEY || process.env.VAPI_API_KEY;
const VAPI_PUBLIC_KEY = process.env.VAPI_PUBLIC_KEY;
const CAIRO_WEBHOOK_URL = process.env.CAIRO_WEBHOOK_URL || 'http://localhost:7860/vapi/webhook';

if (!VAPI_API_KEY) {
  console.error('❌ Please set VAPI_PRIVATE_KEY in your .env file');
  console.log('\n📝 To get started with Vapi:');
  console.log('1. Sign up at https://vapi.ai');
  console.log('2. Go to Dashboard > API Keys');
  console.log('3. Copy your Private API Key');
  console.log('4. Add to .env: VAPI_PRIVATE_KEY=your-key-here');
  console.log('5. Copy your Public Key (for client)');
  console.log('6. Add to .env: VAPI_PUBLIC_KEY=your-public-key-here');
  process.exit(1);
}

// Assistant configuration for Cairo
const assistantConfig = {
  name: "Cairo Home Assistant v2",
  firstMessage: "Hey Mofe! Cairo here. How can I help you with your smart home today?",
  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.7,
    systemPrompt: `You are Cairo, Mofe's (pronounced "mow-feh") friendly and intelligent smart home assistant.

PERSONALITY:
- You have a warm, witty personality like Jarvis from Iron Man
- Be conversational, natural, and engaging
- Keep responses brief and natural for voice interaction
- Build rapport with Mofe over time

CAPABILITIES:
You can control:
- Lights (on/off, brightness, color)
- Temperature and climate
- Scenes (movie, reading, bedtime, etc.)
- Home automation
- Device status and monitoring

IMPORTANT:
- Always wait for the user to finish speaking before responding
- Be helpful and proactive with suggestions
- If something isn't clear, ask for clarification naturally
- Remember context from the conversation`
  },
  voice: {
    provider: "openai",
    voiceId: "nova",
    speed: 1.0
  },
  transcriber: {
    provider: "deepgram",
    model: "nova-2",
    language: "en"
  },
  silenceTimeoutSeconds: 10,
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
            description: "The room to control (or 'all' for all rooms)",
            default: "all"
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
            description: "The room to control (or 'all' for all rooms)",
            default: "all"
          }
        },
        required: ["level"]
      }
    },
    {
      name: "check_temperature",
      description: "Check the current temperature from sensors",
      parameters: {
        type: "object",
        properties: {
          sensor: {
            type: "string",
            description: "Which sensor to check",
            default: "main"
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
            enum: ["movie", "reading", "bedtime", "morning", "party", "romantic", "dinner"],
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
            description: "The device to check (or 'all' for all devices)",
            default: "all"
          }
        }
      }
    },
    {
      name: "process_command",
      description: "Process a general smart home command when no specific function matches",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to process"
          }
        },
        required: ["command"]
      }
    }
  ]
};

async function createAssistant() {
  try {
    console.log('🚀 Creating Cairo voice assistant on Vapi...');
    
    const response = await axios.post(
      'https://api.vapi.ai/assistant',
      assistantConfig,
      {
        headers: {
          'Authorization': `Bearer ${VAPI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const assistant = response.data;
    console.log('✅ Assistant created successfully!');
    console.log(`📝 Assistant ID: ${assistant.id}`);
    console.log(`🔗 Webhook URL: ${CAIRO_WEBHOOK_URL}`);
    
    // Save assistant ID to file
    const config = {
      assistantId: assistant.id,
      publicKey: VAPI_PUBLIC_KEY,
      webhookUrl: CAIRO_WEBHOOK_URL,
      createdAt: new Date().toISOString()
    };
    
    fs.writeFileSync('.vapi-config.json', JSON.stringify(config, null, 2));
    console.log('\n💾 Configuration saved to .vapi-config.json');
    
    console.log('\n🎯 Next steps:');
    console.log('1. Make sure Cairo is running: npm start');
    console.log('2. For local testing, use ngrok: ngrok http 7860');
    console.log('3. Update CAIRO_WEBHOOK_URL in .env with ngrok URL');
    console.log('4. Test with: npm run vapi:test');
    
    return assistant;
  } catch (error) {
    console.error('❌ Error creating assistant:', error.response?.data || error.message);
    process.exit(1);
  }
}

async function updateAssistant(assistantId) {
  try {
    console.log(`🔄 Updating assistant ${assistantId}...`);
    
    const response = await axios.patch(
      `https://api.vapi.ai/assistant/${assistantId}`,
      assistantConfig,
      {
        headers: {
          'Authorization': `Bearer ${VAPI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Assistant updated successfully!');
    return response.data;
  } catch (error) {
    console.error('❌ Error updating assistant:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Check if we should update existing assistant
async function main() {
  // Check for existing config
  if (fs.existsSync('.vapi-config.json')) {
    const config = JSON.parse(fs.readFileSync('.vapi-config.json', 'utf8'));
    console.log(`📋 Found existing assistant: ${config.assistantId}`);
    
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question('Do you want to update it? (y/n): ', resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() === 'y') {
      await updateAssistant(config.assistantId);
    } else {
      console.log('Creating new assistant...');
      await createAssistant();
    }
  } else {
    await createAssistant();
  }
}

main();