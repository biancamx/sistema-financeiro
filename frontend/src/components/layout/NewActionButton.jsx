import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button, Modal } from '../ui/ui.jsx';

const actions = [
  ['Compra no cartão', '/lancamentos/compras?new=1'],
  ['Despesa avulsa', '/lancamentos/dinheiro?new=1&kind=expense'],
  ['Venda', '/lancamentos/dinheiro?new=1&kind=sale'],
  ['Empréstimo', '/lancamentos/dinheiro?new=1&kind=loan'],
  ['Reembolso', '/lancamentos/dinheiro?new=1&kind=refund'],
  ['Gasto de veículo', '/veiculos?new=expense'],
  ['Pagamento / recebimento', '/lancamentos/dinheiro?tab=all&action=receive'],
];

export default function NewActionButton({ mobile = false, floating = false }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <Button
        className={`new-action-trigger ${mobile ? 'new-action-mobile' : ''} ${floating ? 'new-action-floating' : ''}`}
        variant="primary"
        aria-label="Criar novo registro"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={floating ? 'Novo registro' : undefined}
        data-tour={mobile ? 'new-action-mobile' : 'new-action'}
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden="true" />
        {!floating && <span>{mobile ? 'Novo' : 'Novo registro'}</span>}
      </Button>
      <Modal open={open} title="O que deseja registrar?" onClose={() => setOpen(false)}>
        <div className="new-action-list">
          {actions.map(([label, to]) => (
            <button key={label} type="button" onClick={() => { setOpen(false); navigate(to); }}>
              <Plus aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
