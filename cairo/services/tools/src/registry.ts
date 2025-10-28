import type { MCPTool } from './types.js';
import { EventBus } from '../../event-bus/src/bus.js';

export class ToolRegistry {
  private tools: Map<string, MCPTool>;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.tools = new Map();
    this.eventBus = eventBus;

    // Subscribe to tool requests
    this.eventBus.subscribe('tool.request', async (event) => {
      await this.handleToolRequest(event.data);
    });
  }

  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
    console.log(`✅ Registered tool: ${tool.name} (${tool.safety_level})`);
  }

  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  listTools(): void {
    console.log('\n📋 Available tools:');
    for (const tool of this.tools.values()) {
      console.log(`  - ${tool.name}: ${tool.description} [${tool.safety_level}]`);
    }
    console.log('');
  }

  private async handleToolRequest(data: any): Promise<void> {
    const { request_id, tool, args } = data;

    try {
      const toolDef = this.getTool(tool);

      if (!toolDef) {
        throw new Error(`Tool not found: ${tool}`);
      }

      console.log(`🔧 Executing ${tool}:`, args);

      const result = await toolDef.execute(args);

      // Publish success
      await this.eventBus.publish('tool.result', {
        request_id,
        tool,
        result
      });

      console.log(`✅ Tool ${tool} completed successfully`);

    } catch (error: any) {
      console.error(`❌ Tool ${tool} failed:`, error.message);

      // Publish error
      await this.eventBus.publish('tool.error', {
        request_id,
        tool,
        error: error.message
      });
    }
  }
}
