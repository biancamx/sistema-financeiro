import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { peopleApi, purchasesApi, vehiclesApi } from '../../services/api.js';

const normalize = (value) => String(value ?? '').toLocaleLowerCase('pt-BR').trim();

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const term = normalize(query);
    if (term.length < 2) {
      setResults([]);
      setError('');
      setLoading(false);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const [people, purchases, vehicles] = await Promise.all([
          peopleApi.list(),
          purchasesApi.list({ search: term, page: 1, pageSize: 8 }),
          vehiclesApi.list(),
        ]);
        if (!active) return;
        const matchingPeople = people.filter((person) => normalize(person.name).includes(term))
          .slice(0, 5).map((person) => ({ type: 'Pessoa', label: person.name, to: `/pessoas/${person.id}` }));
        const matchingPurchases = (purchases.data ?? []).slice(0, 5)
          .map((purchase) => ({ type: 'Compra', label: purchase.description, to: '/lancamentos/compras' }));
        const matchingVehicles = vehicles.filter((vehicle) => normalize(`${vehicle.model} ${vehicle.plate}`).includes(term))
          .slice(0, 5).map((vehicle) => ({ type: 'Veículo', label: `${vehicle.model} · ${vehicle.plate}`, to: `/veiculos/${vehicle.id}` }));
        setResults([...matchingPeople, ...matchingPurchases, ...matchingVehicles].slice(0, 10));
      } catch (searchError) {
        if (active) {
          setResults([]);
          setError(searchError?.message || 'Não foi possível concluir a busca.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const open = results.length > 0 || Boolean(error) || loading;
  return (
    <div className="global-search">
      <Search aria-hidden="true" />
      <input
        className="input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar pessoas, compras ou veículos"
        aria-label="Busca global"
        aria-expanded={open}
        aria-controls="global-search-results"
      />
      {query && <button type="button" className="global-search-clear" onClick={() => setQuery('')} aria-label="Limpar busca"><X aria-hidden="true" /></button>}
      {open && (
        <div className="global-search-results" id="global-search-results" role="listbox" aria-label="Resultados da busca">
          {loading && <p className="muted">Buscando…</p>}
          {!loading && error && <p className="field-error" role="alert">{error}</p>}
          {!loading && !error && !results.length && <p className="muted">Nenhum resultado encontrado.</p>}
          {!loading && results.map((item, index) => (
            <button type="button" role="option" aria-selected="false" key={`${item.type}-${item.label}-${index}`} onClick={() => {
              navigate(item.to);
              setQuery('');
            }}>
              <small>{item.type}</small><span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
