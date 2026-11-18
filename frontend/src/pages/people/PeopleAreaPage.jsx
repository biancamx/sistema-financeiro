import { useState } from 'react';
import { Link, Outlet, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../components/ui/ui.jsx';
import PeoplePage, { PersonAvatar, PersonEditorModal, PersonProfileMenu } from './PeoplePage.jsx';
import BirthdaysPage from '../birthdays/BirthdaysPage.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { peopleApi } from '../../services/api.js';
import { ErrorState, Spinner, EmptyState } from '../../components/ui/ui.jsx';
import { PersonTabs } from './PersonTabs.jsx';
import { PATHS } from '../../app/paths.js';

export function PeopleAreaPage() {
  const [search, setSearch] = useSearchParams();
  const birthdays = search.get('tab') === 'aniversarios';
  const tabs = (
    <nav className="tabs area-tabs" aria-label="Pessoas e aniversários">
      <button type="button" className={`area-tab ${!birthdays ? 'on' : ''}`} aria-pressed={!birthdays} onClick={() => setSearch({})}>Pessoas</button>
      <button type="button" className={`area-tab ${birthdays ? 'on' : ''}`} aria-pressed={birthdays} onClick={() => setSearch({ tab: 'aniversarios' })}>Aniversários</button>
    </nav>
  );
  return (
    <section className="area-page">
      {birthdays ? (
        <>
          <PageHeader title="Pessoas" subtitle="Cadastros, extratos, planilhas, cobranças e aniversários." />
          {tabs}
          <BirthdaysPage showHeader={false} />
        </>
      ) : <PeoplePage headerContent={tabs} />}
    </section>
  );
}

export function PersonPageLayout() {
  const { personId } = useParams();
  const navigate = useNavigate();
  const [editorOpen, setEditorOpen] = useState(false);
  const people = useFetch(() => peopleApi.list(), [], { cacheKey: 'lookup:people', refreshEvent: 'people:refresh' });
  if (people.error) return <ErrorState error={people.error} onRetry={people.reload} />;
  if (!people.data) return <Spinner />;
  const person = people.data.find((item) => item.id === personId);
  if (!person) return <EmptyState title="Pessoa não encontrada"><Link to={PATHS.people}>Voltar para Pessoas</Link></EmptyState>;
  return (
    <section className="area-page person-area-page">
      <header className="person-profile-header">
        <div className="person-profile-head-row">
          <Link
            className="person-profile-back"
            to={PATHS.people}
            aria-label="Voltar para Pessoas"
            title="Voltar para Pessoas"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
          <span className="person-profile-divider" aria-hidden="true" />
          <div className="person-profile-identity">
            <PersonAvatar person={person} />
            <div className="person-profile-name-row">
              <h1 title={person.name}>{person.name}</h1>
              <PersonProfileMenu person={person} onEdit={() => setEditorOpen(true)} onDeleted={() => navigate(PATHS.people)} />
            </div>
          </div>
        </div>
        <PersonTabs person={person} />
      </header>
      <PersonEditorModal open={editorOpen} person={person} onClose={() => setEditorOpen(false)} />
      <Outlet context={{ person, openEditPerson: () => setEditorOpen(true) }} />
    </section>
  );
}
