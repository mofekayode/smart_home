#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';

console.log('Checking Home Assistant connection...\n');
console.log('HA_URL:', process.env.HA_URL || 'NOT SET!');
console.log('HA_TOKEN:', process.env.HA_TOKEN ? 'SET (hidden)' : 'NOT SET!');

if (!process.env.HA_TOKEN) {
  console.error('\n❌ ERROR: HA_TOKEN not set!');
  console.log('\nYou need to create a .env file in cairo-ha/ with:');
  console.log('HA_URL=http://localhost:8123');
  console.log('HA_TOKEN=your_long_lived_access_token_here');
  console.log('\nTo get a token:');
  console.log('1. Go to Home Assistant');
  console.log('2. Click your profile');
  console.log('3. Scroll to "Long-Lived Access Tokens"');
  console.log('4. Create a new token');
  process.exit(1);
}

const client = axios.create({
  baseURL: `${process.env.HA_URL || 'http://localhost:8123'}/api`,
  headers: {
    Authorization: `Bearer ${process.env.HA_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 5000,
});

async function checkSensors() {
  try {
    // Test basic connection
    const api = await client.get('/');
    console.log('\n✅ Connected to Home Assistant!');
    
    // Check temperature sensor
    console.log('\nChecking sensor.centralite_3310_g_temperature...');
    try {
      const temp = await client.get('/states/sensor.centralite_3310_g_temperature');
      console.log(`✅ FOUND! Current value: ${temp.data.state}${temp.data.attributes.unit_of_measurement}`);
    } catch (e) {
      console.log(`❌ NOT FOUND - ${e.response?.status === 404 ? 'Entity does not exist' : e.message}`);
    }
    
    // Check humidity sensor
    console.log('\nChecking sensor.centralite_3310_g_humidity...');
    try {
      const humidity = await client.get('/states/sensor.centralite_3310_g_humidity');
      console.log(`✅ FOUND! Current value: ${humidity.data.state}${humidity.data.attributes.unit_of_measurement}`);
    } catch (e) {
      console.log(`❌ NOT FOUND - ${e.response?.status === 404 ? 'Entity does not exist' : e.message}`);
    }
    
  } catch (error) {
    console.error('\n❌ FAILED TO CONNECT TO HOME ASSISTANT!');
    if (error.response?.status === 401) {
      console.error('Authentication failed - check your HA_TOKEN');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('Connection refused - is Home Assistant running?');
    } else {
      console.error('Error:', error.message);
    }
  }
}

checkSensors();