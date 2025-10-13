#!/usr/bin/env node
import axios from 'axios';

const CAIRO_URL = 'http://localhost:7860';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

async function testEndpoint(name, method, path, data = null) {
  try {
    const config = { method, url: `${CAIRO_URL}${path}` };
    if (data) config.data = data;
    
    const response = await axios(config);
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    return response.data;
  } catch (error) {
    console.log(`${colors.red}✗${colors.reset} ${name}: ${error.message}`);
    return null;
  }
}

async function testChat(message) {
  try {
    const response = await axios.post(`${CAIRO_URL}/chat`, {
      text: message,
      history: []
    });
    
    if (response.data.reply) {
      console.log(`${colors.green}✓${colors.reset} Chat: "${message}" → Cairo responded`);
      return true;
    }
  } catch (error) {
    console.log(`${colors.red}✗${colors.reset} Chat failed: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log(`\n${colors.blue}Testing Cairo Mock Mode${colors.reset}`);
  console.log(`${colors.gray}Make sure server is running with TEST_MODE=true${colors.reset}\n`);
  
  // Test capabilities
  const caps = await testEndpoint('GET /capabilities', 'GET', '/capabilities');
  if (caps) {
    console.log(`  ${colors.gray}→ ${caps.capabilities.light.count} lights, ${caps.capabilities.switch.count} switch, ${caps.capabilities.sensor.count} sensors${colors.reset}`);
  }
  
  // Test automations
  const autos = await testEndpoint('GET /automations', 'GET', '/automations');
  if (autos) {
    console.log(`  ${colors.gray}→ ${autos.count} automation(s) configured${colors.reset}`);
  }
  
  // Test command - temperature
  const temp = await testEndpoint('POST /command (temperature)', 'POST', '/command', {
    text: "what's the temperature?"
  });
  if (temp?.result) {
    console.log(`  ${colors.gray}→ Temperature: ${temp.result.value}${temp.result.unit}${colors.reset}`);
  }
  
  // Test command - lights
  const lights = await testEndpoint('POST /command (lights on)', 'POST', '/command', {
    text: "turn on the lights"
  });
  if (lights?.result) {
    console.log(`  ${colors.gray}→ Lights command succeeded${colors.reset}`);
  }
  
  // Test automation creation
  const suggest = await testEndpoint('POST /automations/suggest', 'POST', '/automations/suggest', {
    text: "turn on lights when motion detected"
  });
  if (suggest?.proposal) {
    console.log(`  ${colors.gray}→ Created automation: "${suggest.proposal.alias}"${colors.reset}`);
  }
  
  // Test chat integration
  console.log(`\n${colors.yellow}Testing Chat Integration:${colors.reset}`);
  await testChat("Hello Cairo");
  await testChat("What's the temperature?");
  await testChat("Turn on the lights");
  await testChat("Show me my automations");
  
  console.log(`\n${colors.blue}Mock Mode Test Complete!${colors.reset}`);
  console.log(`${colors.gray}You can now develop Cairo without Home Assistant running${colors.reset}\n`);
}

// Run tests
runTests().catch(console.error);