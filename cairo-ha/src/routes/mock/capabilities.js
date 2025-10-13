import { Router } from 'express';

const router = Router();

// Mock capabilities that mirror real Home Assistant setup
const mockCapabilities = {
  capabilities: {
    light: {
      intents: ['LIGHT_ON', 'LIGHT_OFF', 'LIGHT_SET_BRIGHTNESS', 'LIGHT_TOGGLE'],
      count: 2
    },
    switch: {
      intents: ['SWITCH_ON', 'SWITCH_OFF', 'SWITCH_TOGGLE'],
      count: 1
    },
    sensor: {
      intents: ['GET_STATE', 'GET_TEMPERATURE', 'GET_HUMIDITY'],
      count: 2
    },
    binary_sensor: {
      intents: ['GET_MOTION'],
      count: 1
    },
    automation: {
      intents: [],
      count: 1
    }
  },
  entities: {
    light: [
      { 
        id: 'light.short_lamp', 
        name: 'Short Lamp',
        state: 'off',
        attributes: {
          brightness: 0,
          supported_features: 1
        }
      },
      { 
        id: 'light.tall_lamp', 
        name: 'Tall Lamp',
        state: 'off',
        attributes: {
          brightness: 0,
          supported_features: 1
        }
      }
    ],
    switch: [
      { 
        id: 'switch.bot1', 
        name: 'Bot 1',
        state: 'off'
      }
    ],
    sensor: [
      { 
        id: 'sensor.centralite_3310_g_temperature',
        name: 'Temperature Sensor',
        state: '73.4',
        attributes: {
          unit_of_measurement: '°F',
          device_class: 'temperature'
        }
      },
      { 
        id: 'sensor.centralite_3310_g_humidity',
        name: 'Humidity Sensor',
        state: '58',
        attributes: {
          unit_of_measurement: '%',
          device_class: 'humidity'
        }
      }
    ],
    binary_sensor: [
      { 
        id: 'binary_sensor.motion_sensor',
        name: 'Motion Sensor',
        state: 'off',
        attributes: {
          device_class: 'motion'
        }
      }
    ]
  }
};

router.get('/', (_req, res) => {
  console.log('[MOCK] Returning mock capabilities');
  res.json(mockCapabilities);
});

// Support refreshing capabilities (in mock mode, just returns same data)
router.post('/refresh', (_req, res) => {
  console.log('[MOCK] Refreshing capabilities (no-op in mock mode)');
  res.json({ refreshed: true, ...mockCapabilities });
});

export default router;