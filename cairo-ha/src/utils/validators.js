import { ENTITY_RE, KNOWN_ENTITIES } from '../constants.js';

export function normalizeTargets(act) {
  const ids = [];
  if (act.entity_id) ids.push(act.entity_id);
  if (Array.isArray(act.entity_ids)) ids.push(...act.entity_ids);

  const valid = ids.filter(id => ENTITY_RE.test(id) && (KNOWN_ENTITIES.size ? KNOWN_ENTITIES.has(id) : true));
  return valid.length ? valid : null;
}