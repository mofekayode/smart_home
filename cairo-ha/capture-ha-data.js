#!/usr/bin/env node

/**
 * Capture Real Home Assistant Data
 *
 * This script captures all actual HA API responses and saves them
 * to ha-responses.json for use in TEST_MODE while away from home.
 *
 * Usage: node capture-ha-data.js
 */

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HA_URL = process.env.HA_URL;
const HA_TOKEN = process.env.HA_TOKEN;

if (!HA_URL || !HA_TOKEN) {
  console.error('❌ Missing HA_URL or HA_TOKEN in .env file');
  process.exit(1);
}

const client = axios.create({
  baseURL: `${HA_URL}/api`,
  headers: {
    Authorization: `Bearer ${HA_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 8000,
});

// Known entities from constants.js
const ENTITIES = {
  lights: ['light.short_lamp', 'light.tall_lamp'],
  switches: ['switch.bot1'],
  sensors: [
    'sensor.centralite_3310_g_temperature',
    'sensor.centralite_3310_g_humidity'
  ],
  binary_sensors: ['binary_sensor.motion_sensor']
};

const capturedData = {
  timestamp: new Date().toISOString(),
  states: {},
  services: {},
  history: {},
  errors: []
};

console.log('🏠 Cairo HA Data Capture Tool\n');
console.log(`Connected to: ${HA_URL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

/**
 * Capture entity states
 */
async function captureStates() {
  console.log('📊 Capturing entity states...');

  const allEntities = [
    ...ENTITIES.lights,
    ...ENTITIES.switches,
    ...ENTITIES.sensors,
    ...ENTITIES.binary_sensors
  ];

  for (const entityId of allEntities) {
    try {
      const { data } = await client.get(`/states/${entityId}`);
      capturedData.states[entityId] = data;
      console.log(`  ✓ ${entityId}: ${data.state}${data.attributes?.unit_of_measurement || ''}`);
    } catch (error) {
      const errMsg = `Failed to get state for ${entityId}: ${error.message}`;
      console.error(`  ✗ ${errMsg}`);
      capturedData.errors.push(errMsg);
    }
  }

  console.log('');
}

/**
 * Capture service call responses
 */
async function captureServiceCalls() {
  console.log('🔧 Capturing service call responses...');

  // We'll capture the response structure, not actually toggle devices
  // So we'll do non-destructive captures

  // Light service responses
  try {
    // Turn on with default params
    const lightOnResponse = await client.post('/services/light/turn_on', {
      entity_id: ENTITIES.lights[0]
    });
    capturedData.services['light.turn_on'] = lightOnResponse.data;
    console.log('  ✓ light.turn_on');
  } catch (error) {
    console.error(`  ✗ light.turn_on: ${error.message}`);
    capturedData.errors.push(`light.turn_on: ${error.message}`);
  }

  try {
    // Turn off
    const lightOffResponse = await client.post('/services/light/turn_off', {
      entity_id: ENTITIES.lights[0]
    });
    capturedData.services['light.turn_off'] = lightOffResponse.data;
    console.log('  ✓ light.turn_off');
  } catch (error) {
    console.error(`  ✗ light.turn_off: ${error.message}`);
    capturedData.errors.push(`light.turn_off: ${error.message}`);
  }

  // Switch service responses
  try {
    const switchOnResponse = await client.post('/services/switch/turn_on', {
      entity_id: ENTITIES.switches[0]
    });
    capturedData.services['switch.turn_on'] = switchOnResponse.data;
    console.log('  ✓ switch.turn_on');
  } catch (error) {
    console.error(`  ✗ switch.turn_on: ${error.message}`);
    capturedData.errors.push(`switch.turn_on: ${error.message}`);
  }

  try {
    const switchOffResponse = await client.post('/services/switch/turn_off', {
      entity_id: ENTITIES.switches[0]
    });
    capturedData.services['switch.turn_off'] = switchOffResponse.data;
    console.log('  ✓ switch.turn_off');
  } catch (error) {
    console.error(`  ✗ switch.turn_off: ${error.message}`);
    capturedData.errors.push(`switch.turn_off: ${error.message}`);
  }

  // Automation reload
  try {
    const reloadResponse = await client.post('/services/automation/reload', {});
    capturedData.services['automation.reload'] = reloadResponse.data;
    console.log('  ✓ automation.reload');
  } catch (error) {
    console.error(`  ✗ automation.reload: ${error.message}`);
    capturedData.errors.push(`automation.reload: ${error.message}`);
  }

  // Config check
  try {
    const configResponse = await client.post('/config/core/check_config');
    capturedData.services['config.check'] = configResponse.data;
    console.log('  ✓ config.check');
  } catch (error) {
    console.error(`  ✗ config.check: ${error.message}`);
    capturedData.errors.push(`config.check: ${error.message}`);
  }

  console.log('');
}

/**
 * Capture sensor history
 */
async function captureHistory() {
  console.log('📈 Capturing sensor history (last 6 hours)...');

  const historyEntities = [
    ...ENTITIES.sensors,
    ...ENTITIES.binary_sensors
  ];

  const since = new Date(Date.now() - 6 * 3600_000).toISOString();

  for (const entityId of historyEntities) {
    try {
      const { data } = await client.get(`/history/period/${since}`, {
        params: { filter_entity_id: entityId }
      });
      capturedData.history[entityId] = data;

      // Show summary
      const recordCount = data[0]?.length || 0;
      console.log(`  ✓ ${entityId}: ${recordCount} records`);
    } catch (error) {
      const errMsg = `Failed to get history for ${entityId}: ${error.message}`;
      console.error(`  ✗ ${errMsg}`);
      capturedData.errors.push(errMsg);
    }
  }

  console.log('');
}

/**
 * Save captured data to JSON file
 */
async function saveData() {
  const outputPath = join(__dirname, 'src', 'routes', 'mock', 'ha-responses.json');

  try {
    await fs.writeFile(
      outputPath,
      JSON.stringify(capturedData, null, 2),
      'utf-8'
    );
    console.log(`✅ Saved to: ${outputPath}`);
    console.log(`   ${Object.keys(capturedData.states).length} entity states`);
    console.log(`   ${Object.keys(capturedData.services).length} service responses`);
    console.log(`   ${Object.keys(capturedData.history).length} history records`);

    if (capturedData.errors.length > 0) {
      console.log(`\n⚠️  ${capturedData.errors.length} errors occurred:`);
      capturedData.errors.forEach(err => console.log(`   - ${err}`));
    }
  } catch (error) {
    console.error(`❌ Failed to save file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await captureStates();
    await captureServiceCalls();
    await captureHistory();
    await saveData();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Capture complete! You can now use TEST_MODE with real data.');
    console.log('   Run: TEST_MODE=true npm start');
  } catch (error) {
    console.error('\n❌ Capture failed:', error.message);
    process.exit(1);
  }
}

main();
