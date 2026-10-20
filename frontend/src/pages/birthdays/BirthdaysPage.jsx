import { useState } from 'react';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { birthdaysApi } from '../../services/api.js';
import { Button, Card, ErrorState, Field, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { MONTHS } from '../../lib/format.js';

export default function BirthdaysPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch(() => birthdaysApi.list(), []);
  const [f, setF] = useState({ name: '', day: '', month: new Date().getMonth() + 1 });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;

  const add = async (e) => {
    e.preventDefault();
    try {
      await birthdaysApi.create({ name: f.name.trim(), day: Number(f.day), month: Number(f.month) });
      setF({ ...f, name: '', day: '' });
      toast.success('Aniversário adicionado');
      reload();
    } catch (err) { toast.error(err); }
  };
  const remove = async (b) => {
    try { await birthdaysApi.remove(b.id); reload(); } catch (err) { toast.error(err); }
  };
  const currentMonth = new Date().getMonth() + 1;

  return (
    <>
      <PageHeader title="Aniversários" subtitle="Para lembrar de presentes antes do mês chegar" />
      <Card className="mb">
        <form className="form-row" onSubmit={add}>
          <Field label="Nome">{(id) => <input id={id} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />}</Field>
          <Field label="Dia">{(id) => <input id={id} className="input" type="number" min="1" max="31" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} required />}</Field>
          <Field label="Mês">{(id) => <Select id={id} value={f.month} onChange={(v) => setF({ ...f, month: Number(v) })} options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} />}</Field>
          <Button type="submit" variant="primary">Adicionar</Button>
        </form>
      </Card>
      <div className="months-grid">
        {MONTHS.map((m, i) => {
          const list = data.filter((b) => b.month === i + 1);
          return (
            <section key={m} className={`month-card ${i + 1 === currentMonth ? 'now' : ''}`}>
              <h3>{m}</h3>
              {list.length === 0 ? <p className="muted small">—</p> : (
                <ul>
                  {list.map((b) => (
                    <li key={b.id}><span className="day">{String(b.day).padStart(2, '0')}</span><span>{b.name}{b.personId && <small className="birthday-source">Pessoa</small>}</span><button className="icon-btn" onClick={() => remove(b)} aria-label={`Remover ${b.name}`}>×</button></li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
