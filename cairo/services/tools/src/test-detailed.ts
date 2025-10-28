import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HomeAssistantClient } from './ha_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
config({ path: join(__dirname, '../../../.env') });

async function test() {
  console.log('\n🧪 Detailed Home Assistant Test\n');

  const ha = new HomeAssistantClient(
    process.env.HA_URL || 'http://localhost:8123',
    process.env.HA_TOKEN!
  );

  // Test connection
  console.log('1️⃣  Testing connection...');
  const connected = await ha.checkConnection();
  console.log(`   ${connected ? '✅' : '❌'} Connected: ${connected}\n`);

  if (!connected) {
    console.error('❌ Failed to connect to Home Assistant');
    process.exit(1);
  }

  // List all entities
  const entities = await ha.listEntities();

  // Show all sensors
  console.log('2️⃣  YOUR SENSORS (32 total):');
  const sensors = entities.filter(e => e.entity_id.startsWith('sensor.'));
  sensors.forEach(sensor => {
    const name = sensor.attributes.friendly_name || sensor.entity_id;
    console.log(`   📊 ${sensor.entity_id}`);
    console.log(`      Name: "${name}"`);
    console.log(`      State: ${sensor.state}${sensor.attributes.unit_of_measurement ? ' ' + sensor.attributes.unit_of_measurement : ''}`);
  });

  // Show all lights
  console.log('\n3️⃣  YOUR LIGHTS:');
  const lights = entities.filter(e => e.entity_id.startsWith('light.'));
  lights.forEach(light => {
    const name = light.attributes.friendly_name || light.entity_id;
    console.log(`   💡 ${light.entity_id}`);
    console.log(`      Name: "${name}"`);
    console.log(`      State: ${light.state}`);
    if (light.state === 'on') {
      console.log(`      Brightness: ${light.attributes.brightness || 'N/A'}`);
    }
  });

  // Show all switches
  console.log('\n4️⃣  YOUR SWITCHES:');
  const switches = entities.filter(e => e.entity_id.startsWith('switch.'));
  switches.forEach(sw => {
    const name = sw.attributes.friendly_name || sw.entity_id;
    console.log(`   🔌 ${sw.entity_id}`);
    console.log(`      Name: "${name}"`);
    console.log(`      State: ${sw.state}`);
  });

  // Test light control (if lights exist)
  if (lights.length > 0) {
    const testLight = lights[0];
    console.log(`\n5️⃣  TESTING LIGHT CONTROL ON: ${testLight.entity_id}`);

    const currentState = testLight.state;
    console.log(`   Current state: ${currentState}`);

    try {
      // Toggle the light
      const newAction = currentState === 'on' ? 'turn_off' : 'turn_on';
      console.log(`   Attempting to ${newAction}...`);

      await ha.callService('light', newAction, {
        entity_id: testLight.entity_id
      });

      console.log(`   ✅ Command sent successfully!`);

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check new state
      const newState = await ha.getState(testLight.entity_id);
      console.log(`   New state: ${newState.state}`);

      if (newState.state !== currentState) {
        console.log(`   🎉 SUCCESS! Light changed from ${currentState} to ${newState.state}`);

        // Toggle back to original state
        console.log(`   Toggling back to original state...`);
        await ha.callService('light', currentState === 'on' ? 'turn_on' : 'turn_off', {
          entity_id: testLight.entity_id
        });
        console.log(`   ✅ Restored to original state`);
      } else {
        console.log(`   ⚠️  State didn't change (might need more time)`);
      }

    } catch (error: any) {
      console.error(`   ❌ Failed to control light: ${error.message}`);
    }
  }

  console.log('\n✅ Detailed test complete!\n');
}

test().catch((error) => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});
