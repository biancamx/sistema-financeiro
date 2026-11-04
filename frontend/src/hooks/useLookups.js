import { useEffect } from 'react';
import { useFetch } from './useFetch.js';
import { cardsApi, categoriesApi, peopleApi } from '../services/api.js';

/** Listas usadas nos filtros e formulários (pessoas, cartões, categorias). */
export function useLookups() {
  const people = useFetch(() => peopleApi.list(), []);
  const cards = useFetch(() => cardsApi.list(), []);
  const categories = useFetch(() => categoriesApi.list(), []);

  useEffect(() => {
    const refreshPeople = () => people.reload();
    const refreshCards = () => cards.reload();
    const refreshCategories = () => categories.reload();
    window.addEventListener('people:refresh', refreshPeople);
    window.addEventListener('cards:refresh', refreshCards);
    window.addEventListener('categories:refresh', refreshCategories);
    return () => {
      window.removeEventListener('people:refresh', refreshPeople);
      window.removeEventListener('cards:refresh', refreshCards);
      window.removeEventListener('categories:refresh', refreshCategories);
    };
  }, []);

  return {
    people: people.data || [],
    cards: cards.data || [],
    categories: categories.data || [],
    ready: Boolean(people.data && cards.data && categories.data),
    error: people.error || cards.error || categories.error,
    reload: () => { people.reload(); cards.reload(); categories.reload(); },
  };
}
