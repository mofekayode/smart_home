export const ALLOWED_INTENTS = new Set([
  'LIGHT_ON','LIGHT_OFF','LIGHT_SET_BRIGHTNESS','LIGHT_TOGGLE',
  'SWITCH_ON','SWITCH_OFF','SWITCH_TOGGLE',
  'GET_STATE','GET_TEMPERATURE','GET_HUMIDITY','GET_MOTION','GET_CLIMATE',
  'EXPLAIN_UNSUPPORTED'
]);

export const ENTITY_RE = /^(light|switch|sensor|binary_sensor|automation|climate|cover)\.[a-z0-9_]+$/;

export const KNOWN_ENTITIES = new Set([
  'light.short_lamp',
  'light.tall_lamp',
  'switch.bot1',
  'sensor.centralite_3310_g_temperature',
  'sensor.centralite_3310_g_humidity',
  'binary_sensor.motion_sensor'
]);