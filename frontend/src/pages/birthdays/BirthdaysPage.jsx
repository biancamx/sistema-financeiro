import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Cake, MessageCircle, PartyPopper } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { birthdaysApi } from '../../services/api.js';
import { Button, Card, ErrorState, Field, Modal, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { MONTHS } from '../../lib/format.js';

function birthdayGreeting(name) {
  return `Feliz aniversário, ${name}! 🎉 Que seu novo ciclo seja cheio de saúde, alegria e realizações. Um grande abraço!`;
}

function whatsappShareUrl(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export default function BirthdaysPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch(() => birthdaysApi.list(), []);
  const [f, setF] = useState({ name: '', day: '', month: new Date().getMonth() + 1 });
  const [messageDraft, setMessageDraft] = useState(null);
  const celebratedToday = useRef(false);
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const todayBirthdays = data?.filter((birthday) => birthday.month === currentMonth && birthday.day === today.getDate()) || [];

  useEffect(() => {
    if (todayBirthdays.length === 0 || celebratedToday.current) return;
    celebratedToday.current = true;
    confetti({
      particleCount: 110,
      spread: 78,
      origin: { y: 0.62 },
      colors: ['#45b8ae', '#e0b04f', '#73bce3', '#f4faf8'],
      disableForReducedMotion: true,
    });
  }, [todayBirthdays.length]);

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
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(messageDraft);
      toast.success('Mensagem copiada.');
    } catch {
      toast.error(new Error('Não foi possível copiar a mensagem. Verifique a permissão da área de transferência.'));
    }
  };
  const openWhatsApp = () => window.open(whatsappShareUrl(messageDraft), '_blank', 'noopener,noreferrer');

  return (
    <>
      <PageHeader title="Aniversários" subtitle="Para lembrar de presentes antes do mês chegar" />
      {todayBirthdays.length > 0 && (
        <Card className="birthday-celebration" role="status">
          <span className="birthday-celebration-icon"><PartyPopper size={22} aria-hidden="true" /></span>
          <div>
            <strong>Hoje é dia de comemorar!</strong>
            <p>{todayBirthdays.map((birthday) => birthday.name).join(', ')} {todayBirthdays.length === 1 ? 'faz aniversário hoje.' : 'fazem aniversário hoje.'}</p>
          </div>
          <Cake className="birthday-celebration-cake" size={24} aria-hidden="true" />
        </Card>
      )}
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
                    <li key={b.id} className={b.day === today.getDate() && i + 1 === currentMonth ? 'birthday-today' : ''}>
                      <span className="day">{String(b.day).padStart(2, '0')}</span>
                      <span>{b.name}{b.personId && <small className="birthday-source">Pessoa</small>}</span>
                      <span className="birthday-actions">
                        <button className="icon-btn" onClick={() => setMessageDraft(birthdayGreeting(b.name))} aria-label={`Preparar felicitação para ${b.name}`} title="Enviar felicitação">
                          <MessageCircle size={16} aria-hidden="true" />
                        </button>
                        <button className="icon-btn" onClick={() => remove(b)} aria-label={`Remover ${b.name}`}>×</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <Modal
        open={messageDraft !== null}
        title="Felicitação de aniversário"
        className="birthday-message-modal"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setMessageDraft(null)}>Cancelar</Button>
            <Button onClick={copyMessage}>Copiar</Button>
            <Button variant="primary" onClick={openWhatsApp}><MessageCircle size={16} aria-hidden="true" /> Abrir WhatsApp</Button>
          </>
        )}
      >
        <Field label="Mensagem (você pode editar antes de compartilhar)">
          {(id) => <textarea id={id} className="input" rows={5} value={messageDraft ?? ''} onChange={(event) => setMessageDraft(event.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}
