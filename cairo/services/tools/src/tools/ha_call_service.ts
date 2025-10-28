import type { MCPTool } from '../types.js';
import type { HomeAssistantClient } from '../ha_client.js';

export function createCallServiceTool(ha: HomeAssistantClient): MCPTool {
  return {
    name: 'ha.call_service',
    description: 'Call a Home Assistant service to control devices',

    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          enum: ['light', 'switch', 'lock', 'climate', 'cover', 'media_player', 'fan', 'scene'],
          description: 'Service domain'
        },
        service: {
          type: 'string',
          description: 'Service name (e.g., turn_on, turn_off, toggle)'
        },
        data: {
          type: 'object',
          description: 'Service data',
          properties: {
            entity_id: {
              type: 'string',
              description: 'Target entity ID or comma-separated list of entity IDs'
            },
            brightness_pct: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Brightness percentage (0-100) for lights'
            },
            color_temp: {
              type: 'number',
              description: 'Color temperature in mireds'
            },
            rgb_color: {
              type: 'array',
              items: { type: 'number' },
              minItems: 3,
              maxItems: 3,
              description: 'RGB color [red, green, blue] (0-255 each)'
            },
            temperature: {
              type: 'number',
              description: 'Target temperature for climate devices'
            }
          }
        }
      },
      required: ['domain', 'service']
    },

    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        domain: { type: 'string' },
        service: { type: 'string' },
        entity_id: { type: 'string' }
      }
    },

    async execute(input) {
      const { domain, service, data } = input;

      try {
        await ha.callService(domain, service, data);

        return {
          success: true,
          domain,
          service,
          entity_id: data?.entity_id
        };
      } catch (error: any) {
        throw new Error(`Service call failed: ${error.message}`);
      }
    },

    safety_level: 'write_safe'
  };
}
