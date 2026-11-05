import { refreshFetchData } from './fetchDataCache.js';

const LOOKUP_EVENTS = {
  people: 'people:refresh',
  cards: 'cards:refresh',
  categories: 'categories:refresh',
};

export function refreshLookup(name) {
  const eventName = LOOKUP_EVENTS[name];
  if (!eventName) return;
  refreshFetchData(`lookup:${name}`, eventName);
}

export function refreshAllLookups() {
  Object.keys(LOOKUP_EVENTS).forEach(refreshLookup);
}
