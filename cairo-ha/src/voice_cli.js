#!/usr/bin/env node

import 'dotenv/config';
import { continuousMode, singleMode } from './voice_assistant.js';
import { speak } from './voice_speak.js';

// Parse command line arguments
const args = process.argv.slice(2);
const mode = args[0] || 'continuous';

console.log(`
╔═══════════════════════════════════════╗
║     🏠 Cairo Voice Assistant 🎙️        ║
║     Your Smart Home Voice Control     ║
╚═══════════════════════════════════════╝
`);

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Goodbye, Mofe!');
  await speak("Goodbye, Mofe!");
  process.exit(0);
});

// Start the appropriate mode
async function start() {
  try {
    switch(mode) {
      case 'single':
      case 'once':
        await singleMode();
        break;
      
      case 'continuous':
      case 'listen':
      default:
        await continuousMode();
        break;
    }
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await speak("Sorry, I encountered an error and need to restart.");
    process.exit(1);
  }
}

// Show help
if (mode === '--help' || mode === '-h') {
  console.log(`
Usage: npm run voice [mode]

Modes:
  continuous (default) - Keep listening for "Hey Cairo" wake word
  single              - Listen once and exit
  
Examples:
  npm run voice                # Start continuous mode
  npm run voice single         # One-shot command
  
Wake words in continuous mode:
  - "Hey Cairo"
  - "Okay Cairo"  
  - "Cairo"

Voice Commands Examples:
  - "Hey Cairo, turn on the lights"
  - "Cairo, what's the temperature?"
  - "Hey Cairo, set brightness to 50%"
  - "Cairo, movie mode please"
  
Settings (via .env):
  TTS_VOICE - Voice for responses (alloy, echo, fable, onyx, nova, shimmer)
  CAIRO_URL - Cairo server URL (default: http://localhost:7860)
`);
  process.exit(0);
}

// Start the voice assistant
start();