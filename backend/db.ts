import { store } from './store.js';

export function getSetting(key: string): string | undefined {
  if (key === 'user_stopwords') {
    return JSON.stringify(store.getStopwords());
  }
  if (key === 'term_boosts') {
    return JSON.stringify(store.getTermBoosts());
  }
  return undefined;
}

export function setSetting(key: string, value: string): void {
  if (key === 'user_stopwords') {
    store.saveStopwords(JSON.parse(value));
  } else if (key === 'term_boosts') {
    store.saveTermBoosts(JSON.parse(value));
  }
}
