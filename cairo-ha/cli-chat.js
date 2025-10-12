#!/usr/bin/env node
import readline from 'readline';
import axios from 'axios';

// Terminal colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Configuration
const CAIRO_URL = process.env.CAIRO_URL || 'http://localhost:7860';
const chatEndpoint = `${CAIRO_URL}/chat`;

// Initialize readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${colors.cyan}You:${colors.reset} `
});

// Conversation history
let conversationHistory = [];
// Store last automation proposal for follow-up
let lastAutomationProposal = null;

// Helper functions
function printCairo(message) {
  console.log(`${colors.green}${colors.bright}Cairo:${colors.reset} ${message}`);
}

function printAction(action, result) {
  console.log(`${colors.yellow}[Action: ${action.endpoint} ${action.method}]${colors.reset}`);
  if (result) {
    console.log(`${colors.gray}Result: ${JSON.stringify(result, null, 2)}${colors.reset}`);
  }
}

function printError(error) {
  console.log(`${colors.red}Error: ${error}${colors.reset}`);
}

function printWelcome() {
  console.log(`${colors.bright}${colors.blue}
╔══════════════════════════════════════╗
║   Cairo Smart Home Assistant CLI     ║
╚══════════════════════════════════════╝${colors.reset}

${colors.green}${colors.bright}Cairo:${colors.reset} Hey there! I'm Cairo, your smart home assistant. I can control lights, check sensors, manage automations, and chat about your home. What can I help you with?

${colors.gray}Type your message and press Enter. Type 'quit' or 'exit' to leave.
Examples:
  - "Turn on the lights"
  - "What's the temperature and humidity?"
  - "Create an automation for the motion sensor"
  - "Delete the kitchen lights automation"
  - "Show me my automations"
${colors.reset}`);
}

// Send message to Cairo
async function sendMessage(text) {
  try {
    // Add user message to history
    conversationHistory.push({ role: 'user', content: text });
    
    // Send request
    const response = await axios.post(chatEndpoint, {
      text,
      history: conversationHistory
    });
    
    const data = response.data;
    
    // Handle response
    if (data.ok && data.result) {
      // Show immediate acknowledgment if available
      if (data.immediateResponse && data.immediateResponse !== data.reply) {
        printCairo(data.immediateResponse);
        // Small delay to simulate processing
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      // Show Cairo's response with the results
      printCairo(data.reply || 'Action completed successfully');
      
      // Store automation proposal if present for follow-up
      if (data.result.proposal) {
        lastAutomationProposal = data.result.proposal;
        // Add proposal to conversation history for Cairo to reference
        conversationHistory.push({ 
          role: 'assistant', 
          content: `AUTOMATION_PROPOSAL: ${JSON.stringify(lastAutomationProposal)}` 
        });
      }
      
      // Handle deletion success
      if (data.result.deleted) {
        console.log(`${colors.gray}[Deleted ${data.result.deleted} automation(s), ${data.result.remaining} remaining]${colors.reset}`);
      }
      
      // Optionally show debug details if needed
      if (process.env.DEBUG === 'true') {
        console.log(`${colors.gray}[Debug] Raw result: ${JSON.stringify(data.result, null, 2)}${colors.reset}`);
      }
    } else if (data.error) {
      // Error from server
      printError(data.error);
      if (data.raw) {
        console.log(`${colors.gray}Raw response: ${data.raw}${colors.reset}`);
      }
    } else if (data.reply) {
      // Normal conversation - check if Cairo is showing us JSON (debugging)
      if (data.reply.includes('"action"') && data.reply.includes('"endpoint"')) {
        console.log(`${colors.yellow}[Debug: Cairo returned action JSON instead of executing]${colors.reset}`);
        console.log(`${colors.gray}${data.reply}${colors.reset}`);
      } else {
        // Show immediate response if it's different from the final reply
        if (data.immediateResponse && data.immediateResponse !== data.reply) {
          printCairo(data.immediateResponse);
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        printCairo(data.reply);
      }
    } else {
      // Unexpected response format
      console.log(`${colors.gray}Unexpected response: ${JSON.stringify(data)}${colors.reset}`);
    }
    
    // Add Cairo's response to history (if not already added for proposal)
    const lastMsg = conversationHistory[conversationHistory.length - 1];
    if (!lastMsg || !lastMsg.content?.includes('AUTOMATION_PROPOSAL')) {
      conversationHistory.push({ 
        role: 'assistant', 
        content: data.reply || 'Action completed' 
      });
    }
    
    // Keep history size manageable (last 20 messages)
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }
    
  } catch (error) {
    if (error.response) {
      printError(`Server error: ${error.response.data.error || error.response.statusText}`);
    } else if (error.request) {
      printError(`Cannot connect to Cairo server at ${CAIRO_URL}. Is it running?`);
    } else {
      printError(error.message);
    }
  }
}

// Main interaction loop
printWelcome();

rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();
  
  // Check for exit commands
  if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
    console.log(`${colors.blue}Goodbye!${colors.reset}`);
    process.exit(0);
  }
  
  // Check for clear command
  if (input.toLowerCase() === 'clear') {
    console.clear();
    printWelcome();
    rl.prompt();
    return;
  }
  
  // Check for history reset
  if (input.toLowerCase() === 'reset') {
    conversationHistory = [];
    console.log(`${colors.gray}Conversation history cleared${colors.reset}`);
    rl.prompt();
    return;
  }
  
  // Send message to Cairo
  if (input) {
    await sendMessage(input);
  }
  
  rl.prompt();
});

// Handle Ctrl+C
rl.on('SIGINT', () => {
  console.log(`\n${colors.blue}Goodbye!${colors.reset}`);
  process.exit(0);
});

// Handle connection errors
process.on('uncaughtException', (error) => {
  printError(`Unexpected error: ${error.message}`);
  rl.prompt();
});