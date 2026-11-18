import { Link } from 'react-router-dom';
import { Button, Modal, Money } from '../ui/ui.jsx';

const typeLabels = {
  card_invoice: 'Fatura de cartão',
  monthly_budget: 'Planilha mensal',
  vehicle_reminder: 'Lembrete de veículo',
  receivable: 'Valor a receber',
};
const statusLabels = {
  overdue: 'Atrasado',
  today: 'Vence hoje',
  upcoming: 'Em breve',
};

function formatDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR');
}

export default function AlertDetailsModal({ alert, onClose }) {
  const link = alert?.link || alert?.to;
  const status = statusLabels[alert?.status] || 'Precisa de atenção';
  return (
    <Modal open={Boolean(alert)} title={alert?.title || 'Detalhes do aviso'} onClose={onClose} dismissible>
      {alert && (
        <div className="alert-details">
          <div className={`alert-details-status attention-${alert.severity || 'info'}`}>
            <span>{typeLabels[alert.type] || 'Aviso financeiro'}</span>
            <strong>{status}</strong>
          </div>
          {alert.description && <p className="alert-details-description">{alert.description}</p>}
          <dl className="alert-details-facts">
            {alert.amount !== null && alert.amount !== undefined && (
              <div>
                <dt>Valor</dt>
                <dd><Money value={alert.amount} strong /></dd>
              </div>
            )}
            {alert.dueDate && (
              <div>
                <dt>Vencimento</dt>
                <dd>{formatDate(alert.dueDate)}</dd>
              </div>
            )}
          </dl>
          <div className="alert-details-actions">
            <Button variant="ghost" onClick={onClose}>Fechar</Button>
            {link && <Link className="btn btn-primary" to={link} onClick={onClose}>Abrir detalhes</Link>}
          </div>
        </div>
      )}
    </Modal>
  );
}
