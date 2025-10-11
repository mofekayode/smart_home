import { makeHAClient, buildCatalog } from './capabilities.js';

const haClient = makeHAClient();

let lastCatalog = null;
let lastCatalogAt = 0;

export async function getCatalogCached() {
  const now = Date.now();
  if (!lastCatalog || now - lastCatalogAt > 60_000) {
    lastCatalog = await buildCatalog(haClient);
    lastCatalogAt = now;
  }
  return lastCatalog;
}