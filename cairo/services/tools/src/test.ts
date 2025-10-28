import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HomeAssistantClient } from './ha_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
config({ path: join(__dirname, '../../../.env') });

async function test() {
  console.log('\n🧪 Testing Home Assistant Integration\n');

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
    console.error('   Check your HA_URL and HA_TOKEN in .env');
    process.exit(1);
  }

  // List entities
  console.log('2️⃣  Listing entities...');
  const entities = await ha.listEntities();
  console.log(`   ✅ Found ${entities.length} entities\n`);

  // Group by domain
  const byDomain = entities.reduce((acc, entity) => {
    const domain = entity.entity_id.split('.')[0];
    if (!domain) return acc;
    acc[domain] = (acc[domain] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('   📊 Entities by domain:');
  Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([domain, count]) => {
      console.log(`      ${domain}: ${count}`);
    });
  console.log('');

  // Show first 5 lights
  const lights = entities.filter(e => e.entity_id.startsWith('light.'));
  if (lights.length > 0) {
    console.log('3️⃣  Sample lights:');
    lights.slice(0, 5).forEach(light => {
      console.log(`   💡 ${light.entity_id}: ${light.state}`);
      if (light.attributes.friendly_name) {
        console.log(`      "${light.attributes.friendly_name}"`);
      }
    });
    console.log('');

    // Test reading state of first light
    const firstLight = lights[0];
    if (firstLight) {
      console.log(`4️⃣  Reading detailed state of ${firstLight.entity_id}...`);
      const state = await ha.getState(firstLight.entity_id);
      console.log(`   State: ${state.state}`);
      console.log(`   Brightness: ${state.attributes.brightness || 'N/A'}`);
      console.log(`   Last changed: ${state.last_changed}`);
      console.log('');
    }
  }

  // Show first 5 switches
  const switches = entities.filter(e => e.entity_id.startsWith('switch.'));
  if (switches.length > 0) {
    console.log('5️⃣  Sample switches:');
    switches.slice(0, 5).forEach(sw => {
      console.log(`   🔌 ${sw.entity_id}: ${sw.state}`);
      if (sw.attributes.friendly_name) {
        console.log(`      "${sw.attributes.friendly_name}"`);
      }
    });
    console.log('');
  }

  console.log('✅ Home Assistant integration test complete!\n');
}

test().catch((error) => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});
