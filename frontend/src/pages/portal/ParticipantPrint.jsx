import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CalendarDays, FileText, Printer } from 'lucide-react';
import { Button, Modal } from '../../components/ui/ui.jsx';

const brl = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (date) => date ? date.split('-').reverse().join('/') : '—';
const periodValue = (month) => month.year * 12 + month.month;

function itemStatus(item) {
  if (item.pendingAmount <= 0) return 'Pago';
  if (item.paidAmount > 0) return `Parcial · pago ${brl(item.paidAmount)}`;
  return 'Pendente';
}

function StatementTable({ items, withInstallment }) {
  return (
    <table className="participant-print-table">
      <thead>
        <tr>
          <th>Descrição</th>
          {withInstallment && <th>Parcela</th>}
          <th className="participant-print-number">Valor</th>
          <th className="participant-print-number">Pago</th>
          <th className="participant-print-number">Pendente</th>
          <th>Situação</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.description}</td>
            {withInstallment && (
              <td>{item.type === 'installment' && item.totalInstallments > 1
                ? `${item.installmentNumber}/${item.totalInstallments}`
                : 'À vista'}</td>
            )}
            <td className="participant-print-number">{brl(item.amount)}</td>
            <td className="participant-print-number">{brl(item.paidAmount)}</td>
            <td className="participant-print-number">{brl(item.pendingAmount)}</td>
            <td>{itemStatus(item)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MonthStatement({ month }) {
  return (
    <section className="participant-print-month">
      <header className="participant-print-month-header">
        <div>
          <h2>{month.monthName} / {month.year}</h2>
          <p>{month.itemCount} lançamento(s)</p>
        </div>
        <strong>Total do mês: {brl(month.total)}</strong>
      </header>

      <section className="participant-print-section">
        <h3>Faturas dos cartões</h3>
        {month.cards.length === 0 ? <p className="participant-print-empty">Nenhuma fatura de cartão neste mês.</p> : (
          month.cards.map((card) => (
            <section className="participant-print-card" key={card.id}>
              <header className="participant-print-card-header">
                <div>
                  <h4>{card.cardName}</h4>
                  <p>{card.brand || card.bank || 'Cartão'} · Vencimento: {formatDate(card.dueDate)}{!card.dueDate ? ` (dia ${card.dueDay})` : ''} · {card.items.length} lançamento(s)</p>
                </div>
                <div className="participant-print-card-totals">
                  <strong>Total {brl(card.total)}</strong>
                  <span>Pendente {brl(card.pending)}</span>
                </div>
              </header>
              {card.items.length > 0 && <StatementTable items={card.items} withInstallment />}
            </section>
          ))
        )}
      </section>

      <section className="participant-print-section participant-print-fixed">
        <h3>Contas fixas e despesas mensais</h3>
        {month.fixedExpenses.length === 0
          ? <p className="participant-print-empty">Nenhuma conta fixa ou despesa mensal neste período.</p>
          : <StatementTable items={month.fixedExpenses} />}
      </section>

      <footer className="participant-print-month-totals">
        <span>Pago <strong>{brl(month.paid)}</strong></span>
        <span>Saldo pendente <strong>{brl(month.pending)}</strong></span>
      </footer>
    </section>
  );
}

function PrintStatement({ data, month, format }) {
  const isMonthly = format === 'monthly';
  const months = isMonthly ? (month ? [month] : []) : data.months;
  const futurePending = isMonthly && month
    ? data.months.filter((item) => periodValue(item) > periodValue(month))
      .reduce((total, item) => total + item.pending, 0)
    : data.totals.future;
  const totals = isMonthly && month
    ? { paid: month.paid, pending: month.pending, future: futurePending }
    : { paid: data.totals.paid, pending: data.totals.pending, future: data.totals.future };
  const period = isMonthly && month
    ? `${month.monthName} / ${month.year}`
    : 'Todos os períodos disponíveis';

  return (
    <article className="participant-print-document">
      <header className="participant-print-header">
        <div className="participant-print-brand">
          <span className="participant-print-mark">C</span>
          <span>Caderno de Contas</span>
        </div>
        <span className="participant-print-kind">{isMonthly ? 'Demonstrativo mensal' : 'Demonstrativo detalhado'}</span>
        <h1>{data.person.name}</h1>
        <p>Participante · Período: {period}</p>
      </header>

      <section className="participant-print-summary" aria-label="Resumo financeiro">
        <div><span>Total pago</span><strong>{brl(totals.paid)}</strong></div>
        <div><span>Saldo pendente</span><strong>{brl(totals.pending)}</strong></div>
        <div><span>Pendências após o período</span><strong>{brl(totals.future)}</strong></div>
      </section>

      {months.length
        ? months.map((item) => <MonthStatement key={item.key} month={item} />)
        : <p className="participant-print-empty">Não há lançamentos disponíveis para este demonstrativo.</p>}

      <footer className="participant-print-footer">
        <span>Caderno de Contas · Demonstrativo somente para consulta</span>
        <span className="participant-print-page-number" />
      </footer>
    </article>
  );
}

function PrintOption({ icon: Icon, title, description, onClick, disabled = false }) {
  return (
    <button className="participant-print-option" type="button" onClick={onClick} disabled={disabled}>
      <span className="participant-print-option-icon"><Icon size={20} aria-hidden="true" /></span>
      <span><strong>{title}</strong><small>{description}</small></span>
    </button>
  );
}

export default function ParticipantPrint({ data, currentMonth }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState(null);
  const close = () => {
    setOpen(false);
    setFormat(null);
  };
  const selectFormat = (value) => setFormat(value);

  return (
    <>
      <Button
        variant="ghost"
        className="participant-print-trigger"
        onClick={() => setOpen(true)}
        aria-label="Imprimir demonstrativo"
        title="Imprimir demonstrativo"
      >
        <Printer size={18} aria-hidden="true" />
      </Button>

      <Modal
        open={open}
        title={format ? 'Prévia do demonstrativo' : 'Imprimir demonstrativo'}
        wide={Boolean(format)}
        className="participant-print-modal"
        onClose={close}
        dismissible
      >
        {format ? (
          <>
            <div className="participant-print-preview-frame">
              <PrintStatement data={data} month={currentMonth} format={format} />
            </div>
            <div className="participant-print-modal-actions">
              <Button variant="ghost" onClick={() => setFormat(null)}><ArrowLeft size={16} aria-hidden="true" /> Voltar</Button>
              <Button variant="primary" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Imprimir / Salvar em PDF</Button>
            </div>
          </>
        ) : (
          <div className="participant-print-options">
            <p>Escolha quais dados deseja incluir no demonstrativo.</p>
            <PrintOption
              icon={CalendarDays}
              title="Demonstrativo mensal"
              description={currentMonth
                ? `Somente ${currentMonth.monthName} / ${currentMonth.year} e seus lançamentos.`
                : 'Disponível quando houver um mês com lançamentos.'}
              disabled={!currentMonth}
              onClick={() => selectFormat('monthly')}
            />
            <PrintOption
              icon={FileText}
              title="Demonstrativo detalhado"
              description="Todos os períodos disponíveis, organizados por mês e cartão."
              onClick={() => selectFormat('detailed')}
            />
          </div>
        )}
      </Modal>

      {format && createPortal(
        <div className="participant-print-root" aria-hidden="true">
          <PrintStatement data={data} month={currentMonth} format={format} />
        </div>,
        document.body,
      )}
    </>
  );
}
