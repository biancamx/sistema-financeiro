import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useFetch } from '../../hooks/useFetch.js';
import { peopleApi, remindersApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Money, PageHeader, Spinner } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';

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
  const people = useFetch(() => peopleApi.list(), [], { cacheKey: 'lookup:people', refreshEvent: 'people:refresh' });
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();
  const billing = useFetch(() => remindersApi.getPersonBilling(personId, month, year), [personId, month, year]);
  const person = people.data?.find((item) => item.id === personId);
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
      <PageHeader title="Resumo" subtitle="Informações financeiras e próximas pendências." actions={<Button variant="primary" onClick={() => navigate(`/pessoas/${person.id}/cobrar`)}>Cobrar</Button>} />
      {billing.error && <ErrorState error={billing.error} onRetry={billing.reload} />}
      <div className="grid-2 person-summary-grid">
        <Card title="Saldo pendente do mês">
          {billing.data ? <Money value={billing.data.grandTotalPending} strong /> : <Spinner />}
        </Card>
        <Card title="Próximas parcelas">
          {upcoming.length ? <ul className="person-upcoming-list">{upcoming.map((item, index) => (
            <li key={`${item.description}-${index}`}><span>{item.description}<small>{item.cardName}</small></span><Money value={item.balanceDue} /></li>
          ))}</ul> : <EmptyState title="Sem parcelas pendentes neste mês" />}
        </Card>
        {birthdaySoon && <Card title="Aniversário próximo"><p>{birthday.toLocaleDateString('pt-BR')} · faltam {birthday.getDate() - new Date().getDate()} dia(s).</p></Card>}
      </div>
    </>
  );
}

export function PersonPortalPage() {
  const { personId } = useParams();
  const people = useFetch(() => peopleApi.list(), [], { cacheKey: 'lookup:people', refreshEvent: 'people:refresh' });
  const [issuedLink, setIssuedLink] = useState(null);
  const [linkActive, setLinkActive] = useState(null);
  const [portalError, setPortalError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (people.error) return <ErrorState error={people.error} onRetry={people.reload} />;
  if (!people.data) return <Spinner />;
  const person = people.data.find((item) => item.id === personId);
  if (!person) return <EmptyState title="Pessoa não encontrada"><Link to={PATHS.people}>Voltar para Pessoas</Link></EmptyState>;
  const url = issuedLink ? `${window.location.origin}/portal/${issuedLink.token}` : null;
  const createLink = async () => {
    setBusy(true);
    setPortalError(null);
    try {
      const result = await peopleApi.createShareLink(person.id);
      setIssuedLink(result);
      setLinkActive(true);
    } catch (error) {
      setPortalError(error);
    } finally {
      setBusy(false);
    }
  };
  const revokeLink = async () => {
    setBusy(true);
    setPortalError(null);
    try {
      await peopleApi.revokeShareLink(person.id);
      setIssuedLink(null);
      setLinkActive(false);
    } catch (error) {
      setPortalError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Portal do participante" subtitle="Portal de consulta da pessoa." />
      <Card title="Portal do participante">
        <p>Este link permite consultar os dados disponíveis para {person.name}, sem acessar as demais áreas da conta.</p>
        {portalError && <ErrorState error={portalError} onRetry={createLink} />}
        {url ? (
          <>
            <p className="person-portal-url"><a href={url} target="_blank" rel="noreferrer">{url}</a></p>
            <p className="muted small">Este link só será exibido nesta tela e expira em {new Date(issuedLink.expiresAt).toLocaleDateString('pt-BR')}.</p>
          </>
        ) : (
          <p className="muted">O link ativo não pode ser recuperado. Gere um novo para renovar o acesso.</p>
        )}
        <div className="inline">
          {url ? (
            <>
              <Button variant="primary" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>Abrir portal</Button>
              <Button onClick={async () => {
                try { await navigator.clipboard.writeText(url); } catch (error) { setPortalError(error); }
              }}>Copiar link</Button>
            </>
          ) : (
            <Button variant="primary" disabled={busy} onClick={createLink}>{busy ? 'Gerando…' : (linkActive ?? person.share_enabled) ? 'Renovar link' : 'Gerar link'}</Button>
          )}
          {(linkActive ?? person.share_enabled) && <Button variant="ghost" disabled={busy} onClick={revokeLink}>Revogar link ativo</Button>}
        </div>
      </Card>
    </>
  );
}

export { PersonTabs };
