import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';

export default function NotFoundPage() {
  return (
    <EmptyState title="Página não encontrada">
      O endereço não existe. <Link to={PATHS.dashboard}>Voltar ao painel</Link>
    </EmptyState>
  );
}
