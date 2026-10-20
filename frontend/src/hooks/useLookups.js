import { useFetch } from './useFetch.js';
import { cardsApi, categoriesApi, peopleApi } from '../services/api.js';

/** Listas usadas nos filtros e formulários (pessoas, cartões, categorias). */
export function useLookups() {
  const people = useFetch(() => peopleApi.list(), []);
  const cards = useFetch(() => cardsApi.list(), []);
  const categories = useFetch(() => categoriesApi.list(), []);
  return {
    people: people.data || [],
    cards: cards.data || [],
    categories: categories.data || [],
    ready: Boolean(people.data && cards.data && categories.data),
    error: people.error || cards.error || categories.error,
    reload: () => { people.reload(); cards.reload(); categories.reload(); },
  };
}
