import { useEffect, useMemo } from 'react';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useFetch } from '../../hooks/useFetch.js';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { peopleApi, remindersApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';
import { MONTHS, monthLabel, yearsAround } from '../../lib/format.js';

const tabNames = [
  ['resumo', 'Resumo'],
  ['extrato', 'Extrato'],
  ['planilha', 'Planilha'],
  ['cobrar', 'Cobrar'],
];

function PersonTabs({ person, currentTab }) {
  const { pathname } = useLocation();
  const year = new Date().getFullYear();
  const basePath = `/pessoas/${person.id}`;
  const destinations = {
    resumo: `/pessoas/${person.id}`,
    extrato: `/pessoas/${person.id}/extrato/${year}`,
    planilha: `/pessoas/${person.id}/planilha/${year}`,
    cobrar: `/pessoas/${person.id}/cobrar`,
    portal: `/pessoas/${person.id}/portal`,
  };
  return (
    <nav className="tabs area-tabs person-tabs" role="tablist" aria-label={`Seções de ${person.name}`}>
      {tabNames.map(([key, label]) => {
        const selected = currentTab === key || (key === 'resumo'
          ? pathname === basePath
          : pathname === `${basePath}/${key}` || pathname.startsWith(`${basePath}/${key}/`));
        return (
          <NavLink
            key={key}
            to={destinations[key]}
            end={key === 'resumo'}
            role="tab"
            aria-selected={selected}
            className={({ isActive }) => `area-tab ${isActive || selected ? 'on' : ''}`}
          >
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function PersonSummaryPage() {
  const { personId } = useParams();
  const navigate = useNavigate();
  const { month, year, setMonth, setYear } = usePeriod();
  const people = useFetch(() => peopleApi.list(), [], { cacheKey: 'lookup:people', refreshEvent: 'people:refresh' });
  const billing = useFetch(() => remindersApi.getPersonBilling(personId, month, year), [personId, month, year]);
  const person = people.data?.find((item) => item.id === personId);
  const hasSelectedBilling = billing.data?.month === month && billing.data?.year === year;
  const showBillingSpinner = !billing.error && (billing.loading || !hasSelectedBilling);
  const upcoming = useMemo(() => (billing.data?.cards ?? []).flatMap((card) =>
    (card.items ?? []).filter((item) => !item.paid && item.balanceDue > 0).map((item) => ({ ...item, cardName: card.cardName })),
  ).slice(0, 5), [billing.data]);

  if (people.error) return <ErrorState error={people.error} onRetry={people.reload} />;
  if (!people.data || (person && !billing.data && !billing.error)) return <Spinner />;
  if (!person) return <EmptyState title="Pessoa não encontrada"><Link to={PATHS.people}>Voltar para Pessoas</Link></EmptyState>;

  const birthday = person.birth_date ? new Date(`${person.birth_date}T00:00:00`) : null;
  const birthdaySoon = birthday && birthday.getMonth() === new Date().getMonth()
    && birthday.getDate() >= new Date().getDate()
    && birthday.getDate() - new Date().getDate() <= 7;

  return (
    <>
      <PageHeader
        title="Resumo"
        subtitle="Informações financeiras e próximas pendências."
        actions={(
          <>
            <div className="person-summary-period">
              <label className="person-summary-period-field">
                <span>Mês</span>
                <Select
                  value={month}
                  onChange={(value) => setMonth(Number(value))}
                  options={MONTHS.map((label, index) => ({ value: index + 1, label }))}
                  aria-label="Selecionar mês do resumo"
                />
              </label>
              <label className="person-summary-period-field">
                <span>Ano</span>
                <Select
                  value={year}
                  onChange={(value) => setYear(Number(value))}
                  options={yearsAround(year).map((value) => ({ value, label: value }))}
                  aria-label="Selecionar ano do resumo"
                />
              </label>
            </div>
            <Button variant="primary" onClick={() => navigate(`/pessoas/${person.id}/cobrar`)}>Cobrar</Button>
          </>
        )}
      />
      {billing.error && <ErrorState error={billing.error} onRetry={billing.reload} />}
      <div className="grid-2 person-summary-grid">
        <Card title={`Saldo pendente · ${monthLabel(month, year)}`}>
          {showBillingSpinner ? <Spinner /> : billing.data && <Money value={billing.data.grandTotalPending} strong />}
        </Card>
        <Card title={`Próximas parcelas · ${monthLabel(month, year)}`}>
          {showBillingSpinner ? <Spinner /> : billing.data && upcoming.length ? <ul className="person-upcoming-list">{upcoming.map((item, index) => (
            <li key={`${item.description}-${index}`}><span>{item.description}<small>{item.cardName}</small></span><Money value={item.balanceDue} /></li>
          ))}</ul> : billing.data ? <EmptyState title="Sem parcelas pendentes neste mês" /> : null}
        </Card>
        {birthdaySoon && <Card title="Aniversário próximo"><p>{birthday.toLocaleDateString('pt-BR')} · faltam {birthday.getDate() - new Date().getDate()} dia(s).</p></Card>}
      </div>
    </>
  );
}

export function PersonPortalPage() {
  const { personId } = useParams();
  const people = useFetch(() => peopleApi.list(), [], { cacheKey: 'lookup:people', refreshEvent: 'people:refresh' });
  if (people.error) return <ErrorState error={people.error} onRetry={people.reload} />;
  if (!people.data) return <Spinner />;
  const person = people.data.find((item) => item.id === personId);
  if (!person) return <EmptyState title="Pessoa não encontrada"><Link to={PATHS.people}>Voltar para Pessoas</Link></EmptyState>;
  const url = `${window.location.origin}/portal/${person.share_token}`;
  return (
    <>
      <PageHeader title="Portal do participante" subtitle="Portal de consulta da pessoa." />
      <Card title="Portal do participante">
        <p>Este link permite consultar os dados disponíveis para {person.name}, sem acessar as demais áreas da conta.</p>
        <p className="person-portal-url"><a href={url} target="_blank" rel="noreferrer">{url}</a></p>
        <div className="inline">
          <Button variant="primary" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>Abrir portal</Button>
          <Button onClick={async () => {
            try { await navigator.clipboard.writeText(url); } catch (error) { console.error('Falha ao copiar link do portal:', error); }
          }}>Copiar link</Button>
        </div>
      </Card>
    </>
  );
}

export { PersonTabs };
