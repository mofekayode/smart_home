import axios from 'axios';

const client = axios.create({
  baseURL: `${process.env.HA_URL}/api`,
  headers: {
    Authorization: `Bearer ${process.env.HA_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 8000,
});

export const callService = (domain, service, data = {}) =>
  client.post(`/services/${domain}/${service}`, data).then(r => r.data);

export const getState = (entity_id) =>
  client.get(`/states/${entity_id}`).then(r => r.data);

export const getHistory = async (entity_id, hours = 6) => {
  const since = new Date(Date.now() - Number(hours) * 3600_000).toISOString();
  const { data } = await client.get(`/history/period/${since}`, {
    params: { filter_entity_id: entity_id }
  });
  return data;
};

export async function haCheckConfig() {
  const { data } = await client.post('/config/core/check_config');
  return data;
}

export async function haReloadAutomations() {
  const { data } = await client.post('/services/automation/reload', {});
  return data;
}