import { EventBus } from './bus.js';

async function test() {
  const bus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');
  await bus.connect();

  console.log('\n=== Testing EventBus ===\n');

  // Subscribe
  bus.subscribe('wake_word.detected', async (event) => {
    console.log('✅ Received event:', event);
  });

  // Give subscriber time to set up
  await new Promise(resolve => setTimeout(resolve, 500));

  // Publish
  console.log('📤 Publishing wake_word.detected event...');
  await bus.publish('wake_word.detected', {
    confidence: 0.95
  });

  // Wait for event to be processed
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n=== Test complete ===\n');
  await bus.disconnect();
  process.exit(0);
}

test().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
