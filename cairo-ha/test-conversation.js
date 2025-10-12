#!/usr/bin/env node
import axios from 'axios';

const CAIRO_URL = 'http://localhost:7860';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

async function testConversation(text, description) {
  console.log(`\n${colors.blue}${colors.bright}Testing: ${description}${colors.reset}`);
  console.log(`${colors.cyan}You:${colors.reset} ${text}`);
  
  try {
    const response = await axios.post(`${CAIRO_URL}/chat`, {
      text,
      history: []
    });
    
    const data = response.data;
    
    // Show immediate response if present
    if (data.immediateResponse) {
      console.log(`${colors.green}Cairo (immediate):${colors.reset} ${data.immediateResponse}`);
      if (data.immediateResponse !== data.reply) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Show final response
    if (data.reply) {
      console.log(`${colors.green}Cairo:${colors.reset} ${data.reply}`);
    }
    
    // Show if proactive suggestions are included
    if (data.reply && (data.reply.includes('?') || data.reply.includes('Want me to') || data.reply.includes('Would you like'))) {
      console.log(`${colors.gray}✓ Includes proactive suggestion${colors.reset}`);
    }
    
  } catch (error) {
    console.log(`${colors.yellow}Error:${colors.reset}`, error.response?.data?.error || error.message);
  }
}

async function runTests() {
  console.log(`${colors.bright}${colors.blue}
╔══════════════════════════════════════════════╗
║  Testing Cairo's Conversational Improvements  ║
╚══════════════════════════════════════════════╝${colors.reset}`);
  
  // Test temperature query
  await testConversation(
    "what's the temperature?",
    "Temperature query with suggestions"
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test humidity query
  await testConversation(
    "check the humidity",
    "Humidity query with follow-up"
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test combined query
  await testConversation(
    "what's the temperature and humidity?",
    "Combined climate query with contextual suggestions"
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test light control
  await testConversation(
    "turn on the lights",
    "Light control with follow-up offer"
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test automations
  await testConversation(
    "show me my automations",
    "List automations with helpful suggestions"
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test casual conversation
  await testConversation(
    "how are you?",
    "Casual conversation test"
  );
  
  console.log(`\n${colors.bright}${colors.green}✓ All conversation tests completed${colors.reset}`);
  console.log(`${colors.gray}Cairo should now feel more conversational and Jarvis-like!${colors.reset}\n`);
}

runTests().catch(console.error);