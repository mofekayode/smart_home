import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HomeAssistantClient } from './ha_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../../../.env') });

async function check() {
  const ha = new HomeAssistantClient(
    process.env.HA_URL || 'http://localhost:8123',
    process.env.HA_TOKEN!
  );

  console.log('\n🔍 Checking light.tall_lamp details...\n');

  const state = await ha.getState('light.tall_lamp');

  console.log('Entity ID:', state.entity_id);
  console.log('State:', state.state);
  console.log('Last Changed:', state.last_changed);
  console.log('Last Updated:', state.last_updated);
  console.log('\nAttributes:');
  console.log(JSON.stringify(state.attributes, null, 2));

  console.log('\n\n🧪 Now trying to call service...\n');

  try {
    const response = await ha.callService('light', 'turn_off', {
      entity_id: 'light.tall_lamp'
    });

    console.log('✅ Service call response:');
    console.log(JSON.stringify(response, null, 2));

    // Check state after
    await new Promise(r => setTimeout(r, 1000));
    const newState = await ha.getState('light.tall_lamp');
    console.log('\n📖 State after call:', newState.state);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

check();
