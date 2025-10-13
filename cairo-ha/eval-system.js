#!/usr/bin/env node
import axios from 'axios';
import fs from 'fs/promises';

const CAIRO_URL = 'http://localhost:7860';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bright: '\x1b[1m'
};

// Test categories with sample questions
const evaluationSet = {
  'ENVIRONMENTAL_STATUS': [
    "What's the climate situation in here?",
    "Is it comfortable in the house right now?",
    "Give me the room's vitals",
    "What's it like in here?",
    "Is it stuffy in here?",
    "What should I wear around the house?"
  ],
  'LIGHTING_CONTROL': [
    "Turn on the lights",
    "Turn off all lights", 
    "Dim the lights to 30%",
    "Set the lights to 50% brightness",
    "Toggle the tall lamp",
    "Kill all the lights",
    "Maximum brightness",
    "Turn on just the short lamp"
  ],
  'SENSOR_QUERIES': [
    "What's the temperature?",
    "What's the humidity?",
    "Check the motion sensor",
    "Is anyone in the room?",
    "When was the last movement detected?",
    "What's the temperature and humidity?"
  ],
  'SWITCH_CONTROL': [
    "Activate bot1",
    "Turn on the switch",
    "Turn off bot1",
    "Toggle the switch",
    "What's the status of bot1?"
  ],
  'DEVICE_DISCOVERY': [
    "What sensors do I have?",
    "List all devices",
    "What can you control?",
    "How many lights do I have?",
    "Show me all available devices"
  ],
  'AUTOMATIONS': [
    "List my automations",
    "Show me all automations",
    "Create an automation to turn on lights when motion is detected",
    "Delete all automations",
    "How many automations are active?"
  ],
  'CONVERSATIONAL': [
    "Hey Cairo, how's everything?",
    "How are you?",
    "What's your status?",
    "Good morning Cairo",
    "Thank you"
  ],
  'COMPLEX_SCENARIOS': [
    "Set the mood for reading",
    "Prepare for bedtime",
    "Movie mode please",
    "Wake up the house",
    "Everything off"
  ]
};

// Evaluation metrics
const metrics = {
  total: 0,
  successful: 0,
  failed: 0,
  errors: 0,
  byCategory: {},
  failedCommands: [],
  errorCommands: [],
  responseTime: []
};

async function testCommand(command, category) {
  const startTime = Date.now();
  
  try {
    const response = await axios.post(`${CAIRO_URL}/chat`, {
      text: command,
      history: []
    }, {
      timeout: 10000
    });
    
    const responseTime = Date.now() - startTime;
    metrics.responseTime.push(responseTime);
    
    // Check if we got a valid response
    if (response.data.reply || (response.data.ok && response.data.result)) {
      // Additional validation based on command type
      const isValid = validateResponse(command, response.data);
      
      if (isValid) {
        metrics.successful++;
        metrics.byCategory[category].successful++;
        return {
          status: 'SUCCESS',
          command,
          response: response.data.reply?.substring(0, 100) + '...',
          time: responseTime
        };
      } else {
        metrics.failed++;
        metrics.byCategory[category].failed++;
        metrics.failedCommands.push({
          command,
          category,
          reason: 'Invalid response content'
        });
        return {
          status: 'FAILED',
          command,
          reason: 'Invalid response',
          time: responseTime
        };
      }
    } else if (response.data.error) {
      metrics.errors++;
      metrics.byCategory[category].errors++;
      metrics.errorCommands.push({
        command,
        category,
        error: response.data.error
      });
      return {
        status: 'ERROR',
        command,
        error: response.data.error,
        time: responseTime
      };
    }
    
  } catch (error) {
    metrics.errors++;
    metrics.byCategory[category].errors++;
    metrics.errorCommands.push({
      command,
      category,
      error: error.message
    });
    return {
      status: 'ERROR',
      command,
      error: error.message
    };
  }
  
  metrics.total++;
}

function validateResponse(command, response) {
  const cmd = command.toLowerCase();
  const reply = response.reply?.toLowerCase() || '';
  
  // Check for specific expected patterns
  if (cmd.includes('temperature') && !cmd.includes('humidity')) {
    return reply.includes('degree') || reply.includes('°') || reply.includes('temperature');
  }
  if (cmd.includes('humidity') && !cmd.includes('temperature')) {
    return reply.includes('%') || reply.includes('humidity');
  }
  if (cmd.includes('temperature') && cmd.includes('humidity')) {
    return reply.includes('degree') && reply.includes('%');
  }
  if (cmd.includes('turn on') || cmd.includes('turn off')) {
    return reply.includes('light') || reply.includes('on') || reply.includes('off');
  }
  if (cmd.includes('motion')) {
    return reply.includes('motion') || reply.includes('movement') || reply.includes('activity');
  }
  if (cmd.includes('sensors') || cmd.includes('devices')) {
    return reply.includes('light') || reply.includes('sensor') || reply.includes('switch');
  }
  if (cmd.includes('automation')) {
    return reply.includes('automation') || response.result?.automations !== undefined;
  }
  
  // Default: accept any non-empty response
  return reply.length > 0;
}

async function runEvaluation() {
  console.log(`${colors.bright}${colors.blue}
╔══════════════════════════════════════════════════════╗
║         CAIRO EVALUATION SYSTEM v1.0                 ║
║     Testing Natural Language Understanding           ║
╚══════════════════════════════════════════════════════╝
${colors.reset}`);
  
  console.log(`${colors.cyan}Starting evaluation with ${Object.values(evaluationSet).flat().length} test commands...${colors.reset}\n`);
  
  // Initialize category metrics
  for (const category in evaluationSet) {
    metrics.byCategory[category] = {
      total: 0,
      successful: 0,
      failed: 0,
      errors: 0
    };
  }
  
  // Run tests by category
  for (const [category, commands] of Object.entries(evaluationSet)) {
    console.log(`\n${colors.yellow}Testing ${category}:${colors.reset}`);
    
    for (const command of commands) {
      metrics.total++;
      metrics.byCategory[category].total++;
      
      process.stdout.write(`  Testing: "${command.substring(0, 50)}..." `);
      
      const result = await testCommand(command, category);
      
      if (result.status === 'SUCCESS') {
        console.log(`${colors.green}✓${colors.reset} (${result.time}ms)`);
      } else if (result.status === 'FAILED') {
        console.log(`${colors.yellow}⚠${colors.reset} (${result.reason})`);
      } else {
        console.log(`${colors.red}✗${colors.reset} (${result.error})`);
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Calculate statistics
  const avgResponseTime = metrics.responseTime.reduce((a, b) => a + b, 0) / metrics.responseTime.length;
  const successRate = (metrics.successful / metrics.total * 100).toFixed(1);
  
  // Print summary report
  console.log(`\n${colors.bright}${colors.cyan}
╔══════════════════════════════════════════════════════╗
║                   EVALUATION RESULTS                 ║
╚══════════════════════════════════════════════════════╝
${colors.reset}`);
  
  console.log(`
${colors.bright}Overall Performance:${colors.reset}
  Total Commands: ${metrics.total}
  Successful: ${colors.green}${metrics.successful}${colors.reset} (${successRate}%)
  Failed: ${colors.yellow}${metrics.failed}${colors.reset}
  Errors: ${colors.red}${metrics.errors}${colors.reset}
  Avg Response Time: ${avgResponseTime.toFixed(0)}ms
  
${colors.bright}Performance by Category:${colors.reset}`);
  
  for (const [category, stats] of Object.entries(metrics.byCategory)) {
    const catSuccessRate = (stats.successful / stats.total * 100).toFixed(0);
    const statusColor = catSuccessRate >= 80 ? colors.green : 
                        catSuccessRate >= 60 ? colors.yellow : colors.red;
    
    console.log(`  ${category}: ${statusColor}${catSuccessRate}%${colors.reset} (${stats.successful}/${stats.total})`);
  }
  
  // Show problematic commands
  if (metrics.failedCommands.length > 0) {
    console.log(`\n${colors.yellow}${colors.bright}Failed Commands:${colors.reset}`);
    metrics.failedCommands.slice(0, 5).forEach(cmd => {
      console.log(`  • "${cmd.command}" (${cmd.category}): ${cmd.reason}`);
    });
  }
  
  if (metrics.errorCommands.length > 0) {
    console.log(`\n${colors.red}${colors.bright}Error Commands:${colors.reset}`);
    metrics.errorCommands.slice(0, 5).forEach(cmd => {
      console.log(`  • "${cmd.command}" (${cmd.category}): ${cmd.error}`);
    });
  }
  
  // Generate report file
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: metrics.total,
      successful: metrics.successful,
      failed: metrics.failed,
      errors: metrics.errors,
      successRate: successRate + '%',
      avgResponseTime: avgResponseTime.toFixed(0) + 'ms'
    },
    byCategory: metrics.byCategory,
    failedCommands: metrics.failedCommands,
    errorCommands: metrics.errorCommands
  };
  
  await fs.writeFile(
    'evaluation-report.json',
    JSON.stringify(report, null, 2)
  );
  
  console.log(`\n${colors.gray}Full report saved to evaluation-report.json${colors.reset}`);
  
  // Final verdict
  console.log(`\n${colors.bright}${colors.blue}VERDICT: ${colors.reset}`);
  if (successRate >= 90) {
    console.log(`${colors.green}${colors.bright}EXCELLENT - Cairo is performing very well!${colors.reset}`);
  } else if (successRate >= 75) {
    console.log(`${colors.green}GOOD - Cairo is working well with room for improvement${colors.reset}`);
  } else if (successRate >= 60) {
    console.log(`${colors.yellow}FAIR - Cairo needs some tuning${colors.reset}`);
  } else {
    console.log(`${colors.red}NEEDS WORK - Cairo requires significant improvements${colors.reset}`);
  }
  
  console.log('\n');
}

// Check if server is running
async function checkServer() {
  try {
    await axios.get(`${CAIRO_URL}/health`);
    return true;
  } catch {
    console.log(`${colors.red}Error: Cairo server is not running on ${CAIRO_URL}${colors.reset}`);
    console.log(`${colors.gray}Start the server with: TEST_MODE=true npm start${colors.reset}`);
    return false;
  }
}

// Main
async function main() {
  const serverUp = await checkServer();
  if (!serverUp) {
    process.exit(1);
  }
  
  await runEvaluation();
}

main().catch(console.error);