import type { MCPTool } from '../types.js';
import type { HomeAssistantClient } from '../ha_client.js';

export function createReadStateTool(ha: HomeAssistantClient): MCPTool {
  return {
    name: 'ha.read_state',
    description: 'Read the current state of a Home Assistant entity',

    inputSchema: {
      type: 'object',
      properties: {
        entity_id: {
          type: 'string',
          description: 'Entity ID (e.g., light.living_room_lamp)',
          pattern: '^[a-z_]+\\.[a-z0-9_]+$'
        }
      },
      required: ['entity_id']
    },

    outputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string' },
        attributes: { type: 'object' },
        last_changed: { type: 'string' }
      }
    },

    async execute(input) {
      const { entity_id } = input;

      try {
        const state = await ha.getState(entity_id);

        return {
          state: state.state,
          attributes: state.attributes,
          last_changed: state.last_changed
        };
      } catch (error: any) {
        throw new Error(`Failed to read ${entity_id}: ${error.message}`);
      }
    },

    safety_level: 'read'
  };
}
