import { EventBus } from '../../event-bus/src/bus.js';
import { HomeAssistantClient } from './ha_client.js';
import { ToolRegistry } from './registry.js';
import { createReadStateTool } from './tools/ha_read_state.js';
import { createCallServiceTool } from './tools/ha_call_service.js';

async function main() {
  console.log('\n🚀 Starting Cairo Tools Service...\n');

  // Connect to event bus
  const eventBus = new EventBus(
    process.env.REDIS_URL || 'redis://localhost:6379'
  );
  await eventBus.connect();
  console.log('✅ Connected to Redis Event Bus');

  // Connect to Home Assistant
  const ha = new HomeAssistantClient(
    process.env.HA_URL || 'http://localhost:8123',
    process.env.HA_TOKEN!
  );

  console.log('🔌 Connecting to Home Assistant...');
  const connected = await ha.checkConnection();
  if (!connected) {
    throw new Error('Failed to connect to Home Assistant');
  }
  console.log('✅ Connected to Home Assistant');

  // Create tool registry
  const registry = new ToolRegistry(eventBus);

  // Register tools
  registry.registerTool(createReadStateTool(ha));
  registry.registerTool(createCallServiceTool(ha));

  // List available tools
  registry.listTools();

  console.log('🎯 Tools service ready - listening for tool.request events\n');
}

main().catch((error) => {
  console.error('❌ Tools service failed to start:', error);
  process.exit(1);
});
