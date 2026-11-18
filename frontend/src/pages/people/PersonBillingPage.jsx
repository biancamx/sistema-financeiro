import { useOutletContext } from 'react-router-dom';
import { PageHeader } from '../../components/ui/ui.jsx';
import PeoplePage from './PeoplePage.jsx';

export default function PersonBillingPage() {
  const { person, openEditPerson } = useOutletContext();
  return (
    <>
      <PageHeader title="Cobrança" subtitle="Demonstrativo mensal e opções de cobrança." />
      <PeoplePage
        initialBillingPersonId={person.id}
        onlyPersonId={person.id}
        showHeader={false}
        profileCard
        onAddPhone={openEditPerson}
      />
    </>
  );
}
