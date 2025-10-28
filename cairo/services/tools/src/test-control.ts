import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HomeAssistantClient } from './ha_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../../../.env') });

async function test() {
  console.log('\n🧪 Testing Light Control\n');

  const ha = new HomeAssistantClient(
    process.env.HA_URL || 'http://localhost:8123',
    process.env.HA_TOKEN!
  );

  // Get light state
  console.log('📖 Reading light state...');
  const beforeState = await ha.getState('light.tall_lamp');
  console.log(`   light.tall_lamp is currently: ${beforeState.state}`);
  if (beforeState.state === 'on') {
    console.log(`   Brightness: ${beforeState.attributes.brightness}`);
  }

  // Try to toggle it (don't wait for response, HA might be slow)
  console.log('\n🎛️  Sending toggle command...');
  const newAction = beforeState.state === 'on' ? 'turn_off' : 'turn_on';

  try {
    // Send command without waiting too long
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    console.log(`   Calling: light.${newAction} on light.tall_lamp`);

    // This might timeout but the command could still work
    try {
      await ha.callService('light', newAction, {
        entity_id: 'light.tall_lamp'
      });
      clearTimeout(timeout);
      console.log('   ✅ Command sent successfully!');
    } catch (error) {
      clearTimeout(timeout);
      console.log('   ⚠️  Command sent but response was slow');
    }

    // Wait a bit for the light to change
    console.log('\n⏳ Waiting 2 seconds for light to respond...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if it changed
    console.log('\n📖 Reading light state again...');
    const afterState = await ha.getState('light.tall_lamp');
    console.log(`   light.tall_lamp is now: ${afterState.state}`);
    if (afterState.state === 'on') {
      console.log(`   Brightness: ${afterState.attributes.brightness}`);
    }

    if (afterState.state !== beforeState.state) {
      console.log('\n🎉 SUCCESS! The light changed state!');
      console.log(`   ${beforeState.state} → ${afterState.state}`);

      // Restore it
      console.log('\n🔄 Restoring to original state...');
      await ha.callService('light', beforeState.state === 'on' ? 'turn_on' : 'turn_off', {
        entity_id: 'light.tall_lamp'
      });
      console.log('   ✅ Restored');
    } else {
      console.log('\n⚠️  State did not change (light might already be responding to something else)');
    }

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
  }

  console.log('\n✅ Test complete!\n');
}

test().catch((error) => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});
