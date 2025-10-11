// src/capabilities.js
import axios from 'axios';

export function makeHAClient() {
  return axios.create({
    baseURL: `${process.env.HA_URL}/api`,
    headers: {
      Authorization: `Bearer ${process.env.HA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 8000,
  });
}

export async function fetchServices(client) {
  const { data } = await client.get('/services');
  // returns [{domain, services:{ turn_on:{fields...}, turn_off:{...}}}, ...]
  return data;
}

export async function fetchEntities(client) {
  const { data } = await client.get('/states');
  // returns array of entity state objects
  return data;
}

// Build a concise catalog the LLM can handle
export async function buildCatalog(client) {
  const [services, states] = await Promise.all([fetchServices(client), fetchEntities(client)]);

  // Entities grouped by domain, only include ones that are actionable or informative
  const entitiesByDomain = {};
  for (const s of states) {
    const [domain] = s.entity_id.split('.');
    if (!entitiesByDomain[domain]) entitiesByDomain[domain] = [];
    // keep a small, useful projection
    entitiesByDomain[domain].push({
      id: s.entity_id,
      friendly_name: s.attributes.friendly_name || null,
      supported_color_modes: s.attributes.supported_color_modes || null,
      unit: s.attributes.unit_of_measurement || null,
    });
  }

  // Extract which verbs exist for common domains
  const svcIndex = {};
  for (const d of services) {
    svcIndex[d.domain] = Object.keys(d.services || {});
  }

  // Minimal capability set the AI should reason over
  const capabilities = {
    light: {
      intents: ["LIGHT_ON", "LIGHT_OFF", "LIGHT_SET_BRIGHTNESS", "LIGHT_TOGGLE"],
      services: svcIndex.light || [],
      params: {
        brightness_pct: "0..100",
        color_temp_kelvin: "1500..6500 (if supported)",
        rgb_color: "[r,g,b] (if supported)"
      }
    },
    switch: {
      intents: ["SWITCH_ON", "SWITCH_OFF", "SWITCH_TOGGLE"],
      services: svcIndex.switch || [],
      params: {}
    },
    sensor: {
      intents: ["GET_TEMPERATURE", "GET_HUMIDITY", "GET_STATE"],
      services: svcIndex.sensor || [],
      params: {}
    },
    binary_sensor: {
      intents: ["GET_MOTION", "GET_STATE"],
      services: svcIndex.binary_sensor || [],
      params: {}
    }
  };

  // Small, pruned entity lists so prompts stay compact
  const prune = (arr, limit=50) => arr.slice(0, limit);

  const catalog = {
    capabilities,
    entities: {
      light: prune(entitiesByDomain.light || []),
      switch: prune(entitiesByDomain.switch || []),
      sensor: prune(entitiesByDomain.sensor || []),
      binary_sensor: prune(entitiesByDomain.binary_sensor || []),
    }
  };

  return catalog;
}
