import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleHelp, Clock3, Copy, CreditCard, FileText, MessageCircle, PartyPopper, ShieldCheck } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import { portalApi } from '../../services/api.js';
import { Button, Field, Modal, Spinner } from '../../components/ui/ui.jsx';

const brl = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const confettiColors = ['#45b8ae', '#e0b04f', '#73bce3', '#f4faf8', '#ff7b89', '#a88bfa'];
const confettiPieces = Array.from({ length: 72 }, (_, index) => ({
  left: `${(index * 37) % 100}%`,
  delay: `${(index % 12) * 0.11}s`,
  duration: `${4.8 + (index % 8) * 0.24}s`,
  drift: `${((index * 53) % 181) - 90}px`,
  depth: `${(index % 7) * 18}px`,
  width: `${5 + (index % 4) * 2}px`,
  height: `${9 + (index % 5) * 3}px`,
  color: confettiColors[index % confettiColors.length],
  shape: index % 3,
}));

function itemMessage(personName, month, item, cardName) {
  const reference = `${month.monthName}/${month.year}`;
  return `Olá! Sou ${personName} e estava conferindo meu demonstrativo de ${reference}.\n\nLançamento: ${item.description}${cardName ? `\nCartão: ${cardName}` : ''}\nValor: ${brl(item.amount)}${item.type === 'installment' && item.totalInstallments > 1 ? `\nParcela: ${item.installmentNumber}/${item.totalInstallments}` : ''}\n\nPoderia me explicar esse valor, por favor?`;
}

function whatsappUrl(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const fullNumber = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${fullNumber}?text=${encodeURIComponent(message)}`;
}

function TotalCard({ icon: Icon, label, value, tone }) {
  return (
    <div className={`participant-total participant-total-${tone}`}>
      <span className="participant-total-icon"><Icon size={18} aria-hidden="true" /></span>
      <span className="participant-total-label">{label}</span>
      <strong>{brl(value)}</strong>
    </div>
  );
}

export default function PortalPage() {
  const { token } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [monthIndex, setMonthIndex] = useState(0);
  const [expandedCards, setExpandedCards] = useState({});
  const [messageDraft, setMessageDraft] = useState(null);
  const [birthdayCelebration, setBirthdayCelebration] = useState(0);
  const celebratedBirthday = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    portalApi.get(token)
      .then((result) => {
        if (active) {
          setData(result);
          const now = new Date();
          const currentMonthIndex = result.months.findIndex(
            (month) => month.year === now.getFullYear() && month.month === now.getMonth() + 1,
          );
          setMonthIndex(currentMonthIndex >= 0 ? currentMonthIndex : Math.max(0, result.months.length - 1));
          setExpandedCards({});
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  const currentMonth = data?.months[monthIndex];
  const adminPhone = data?.admin?.phone;
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDay = now.getDate();
  const isBirthdayToday = data?.person.birthday?.day === now.getDate()
    && data?.person.birthday?.month === now.getMonth() + 1;

  useEffect(() => {
    if (!isBirthdayToday) return;
    const celebrationKey = `${token}-${todayYear}-${todayMonth}-${todayDay}`;
    if (celebratedBirthday.current === celebrationKey) return;
    celebratedBirthday.current = celebrationKey;
    setBirthdayCelebration((run) => run + 1);
  }, [isBirthdayToday, token, todayYear, todayMonth, todayDay]);

  useEffect(() => {
    if (!isBirthdayToday || birthdayCelebration === 0) return;
    confetti({
      particleCount: 150,
      spread: 100,
      startVelocity: 48,
      origin: { x: 0.5, y: 0.68 },
      colors: confettiColors,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 65,
      angle: 60,
      spread: 65,
      startVelocity: 52,
      origin: { x: 0, y: 0.72 },
      colors: confettiColors,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 65,
      angle: 120,
      spread: 65,
      startVelocity: 52,
      origin: { x: 1, y: 0.72 },
      colors: confettiColors,
      disableForReducedMotion: true,
    });
  }, [isBirthdayToday, birthdayCelebration]);

  const copyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Mensagem copiada para você enviar ao responsável.');
    } catch {
      toast.error(new Error('Não foi possível copiar a mensagem. Verifique a permissão da área de transferência.'));
    }
  };

  const currentMessage = currentMonth && `Olá! Gostaria de conversar sobre meu demonstrativo de ${currentMonth.monthName}/${currentMonth.year}.`;
  const openMessagePreview = (message) => setMessageDraft(message);
  const openWhatsApp = () => {
    const url = whatsappUrl(adminPhone, messageDraft ?? '');
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };
  const toggleCard = (cardId) => setExpandedCards((previous) => ({ ...previous, [cardId]: !previous[cardId] }));

  if (loading) return <main className="participant-portal"><Spinner label="Carregando seu portal…" /></main>;
  if (error) {
    return (
      <main className="participant-portal">
        <section className="participant-error">
          <ShieldCheck size={32} aria-hidden="true" />
          <h1>Portal indisponível</h1>
          <p>Este link não é válido ou não está mais disponível. Peça um novo link ao responsável pelas contas.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="participant-portal">
      <div className="participant-shell">
        <header className="participant-header">
          <div className="participant-brand"><span className="participant-brand-mark">C</span><span>Caderno de Contas</span></div>
          <span className="participant-readonly"><ShieldCheck size={15} aria-hidden="true" /> Somente leitura</span>
        </header>

        <section className="participant-welcome">
          <div className="participant-avatar">
            {data.person.avatar
              ? <img src={data.person.avatar} alt="" />
              : <span>{data.person.name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '?'}</span>}
          </div>
          <div>
            <p className="participant-eyebrow">Portal do participante</p>
            <h1>Olá, {data.person.name}</h1>
            <p>Acompanhe seus lançamentos, pagamentos e valores pendentes.</p>
          </div>
        </section>

        {isBirthdayToday && (
          <section className="participant-birthday-banner" role="status">
            <span className="participant-birthday-icon"><PartyPopper size={22} aria-hidden="true" /></span>
            <div>
              <strong>Hoje é seu dia, {data.person.name}!</strong>
              <p>Desejamos um aniversário cheio de alegria e um novo ciclo especial.</p>
            </div>
            <button
              type="button"
              className="btn btn-primary participant-celebrate-button"
              onClick={() => setBirthdayCelebration((run) => run + 1)}
            >
              <PartyPopper size={16} aria-hidden="true" /> Soltar confetes
            </button>
          </section>
        )}

        <section className="participant-totals" aria-label="Resumo financeiro">
          <TotalCard icon={CheckCircle2} label="Total pago" value={data.totals.paid} tone="paid" />
          <TotalCard icon={Clock3} label="Saldo pendente" value={data.totals.pending} tone="pending" />
          <TotalCard icon={CalendarDays} label="Pendências futuras" value={data.totals.future} tone="future" />
        </section>

        <section className="participant-month-section">
          <div className="participant-section-heading">
            <div>
              <p className="participant-eyebrow">Seu demonstrativo</p>
              <h2>Meses e lançamentos</h2>
            </div>
            <button
              type="button"
              className="btn btn-primary participant-contact"
              disabled={!currentMessage}
              onClick={() => currentMessage && openMessagePreview(currentMessage)}
            >
              <CircleHelp size={16} aria-hidden="true" /> Questionar no WhatsApp
            </button>
          </div>

          {data.months.length === 0 ? (
            <div className="participant-empty">
              <CreditCard size={24} aria-hidden="true" />
              <strong>Nenhum lançamento registrado</strong>
              <span>Quando houver lançamentos associados a você, eles aparecerão aqui.</span>
            </div>
          ) : (
            <>
              <div className="participant-month-nav">
                <button type="button" aria-label="Mês anterior" disabled={monthIndex === 0} onClick={() => setMonthIndex((index) => Math.max(0, index - 1))}>
                  <ChevronLeft size={19} aria-hidden="true" />
                </button>
                <div>
                  <strong>{currentMonth.monthName} / {currentMonth.year}</strong>
                  <span>{currentMonth.itemCount} lançamento(s) · {brl(currentMonth.total)}</span>
                </div>
                <button type="button" aria-label="Próximo mês" disabled={monthIndex >= data.months.length - 1} onClick={() => setMonthIndex((index) => Math.min(data.months.length - 1, index + 1))}>
                  <ChevronRight size={19} aria-hidden="true" />
                </button>
              </div>

              <section className="participant-group-section" aria-label="Faturas dos cartões">
                <h3>Faturas dos cartões</h3>
                {currentMonth.cards.length === 0 ? (
                  <div className="participant-group-empty">Nenhuma fatura de cartão para este mês.</div>
                ) : (
                  <div className="participant-card-groups">
                    {currentMonth.cards.map((card) => {
                      const isExpanded = Boolean(expandedCards[card.id]);
                      return (
                        <section className="participant-card-group" key={card.id}>
                          <button
                            className="participant-card-toggle"
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleCard(card.id)}
                          >
                            <span className="participant-card-icon" style={{ '--participant-card-color': card.color }}>
                              <CreditCard size={19} aria-hidden="true" />
                            </span>
                            <span className="participant-card-info">
                              <strong>{card.cardName}</strong>
                              <span>
                                {card.brand || card.bank || 'Cartão'} · {card.dueDate ? `vence ${card.dueDate.split('-').reverse().join('/')}` : `vence dia ${card.dueDay}`} · {card.items.length} item(ns)
                              </span>
                            </span>
                            <span className="participant-card-totals">
                              <strong>{brl(card.total)}</strong>
                              <span className={card.pending > 0 ? 'is-pending' : 'is-paid'}>
                                {card.pending > 0 ? `Pendente ${brl(card.pending)}` : 'Quitado'}
                              </span>
                            </span>
                            {isExpanded
                              ? <ChevronUp size={19} aria-hidden="true" />
                              : <ChevronDown size={19} aria-hidden="true" />}
                          </button>
                          {isExpanded && (
                            <div className="participant-card-items">
                              {card.items.map((item) => (
                                <article className="participant-item" key={item.id}>
                                  <div className="participant-item-icon"><CreditCard size={17} aria-hidden="true" /></div>
                                  <div className="participant-item-description">
                                    <strong>{item.description}</strong>
                                    <span>
                                      {item.totalInstallments > 1
                                        ? `Parcela ${item.installmentNumber}/${item.totalInstallments}${item.remaining ? ` · ${item.remaining} restante(s)` : ''}`
                                        : 'Compra à vista'}
                                    </span>
                                  </div>
                                  <div className="participant-item-value">
                                    <strong>{brl(item.amount)}</strong>
                                    <span className={`participant-status ${item.pendingAmount === 0 ? 'is-paid' : item.paidAmount > 0 ? 'is-partial' : 'is-pending'}`}>
                                      {item.pendingAmount === 0 ? 'Pago' : item.paidAmount > 0 ? `Parcial · falta ${brl(item.pendingAmount)}` : 'Pendente'}
                                    </span>
                                  </div>
                                  <button className="participant-question" type="button" aria-label={`Questionar ${item.description}`} onClick={() => openMessagePreview(itemMessage(data.person.name, currentMonth, item, card.cardName))}>
                                    <CircleHelp size={17} aria-hidden="true" />
                                  </button>
                                </article>
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="participant-group-section participant-fixed-section" aria-label="Contas fixas e despesas mensais">
                <h3><FileText size={15} aria-hidden="true" /> Contas fixas e despesas mensais</h3>
                {currentMonth.fixedExpenses.length === 0 ? (
                  <div className="participant-group-empty">Nenhuma conta fixa ou despesa geral para este mês.</div>
                ) : (
                  <div className="participant-items">
                    {currentMonth.fixedExpenses.map((item) => (
                      <article className="participant-item" key={item.id}>
                        <div className="participant-item-icon"><FileText size={17} aria-hidden="true" /></div>
                        <div className="participant-item-description">
                          <strong>{item.description}</strong>
                          <span>Planilha mensal</span>
                        </div>
                        <div className="participant-item-value">
                          <strong>{brl(item.amount)}</strong>
                          <span className={`participant-status ${item.pendingAmount === 0 ? 'is-paid' : item.paidAmount > 0 ? 'is-partial' : 'is-pending'}`}>
                            {item.pendingAmount === 0 ? 'Pago' : item.paidAmount > 0 ? `Parcial · falta ${brl(item.pendingAmount)}` : 'Pendente'}
                          </span>
                        </div>
                        <button className="participant-question" type="button" aria-label={`Questionar ${item.description}`} onClick={() => openMessagePreview(itemMessage(data.person.name, currentMonth, item))}>
                          <CircleHelp size={17} aria-hidden="true" />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </section>

        <footer className="participant-footer">
          <ShieldCheck size={14} aria-hidden="true" />
          Os dados são privados e este portal permite apenas consulta. Para corrigir um lançamento, fale com o responsável.
        </footer>
      </div>
      <Modal
        open={messageDraft !== null}
        title="Revisar mensagem"
        className="participant-message-modal"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setMessageDraft(null)}>Cancelar</Button>
            <Button onClick={() => copyMessage(messageDraft ?? '')}><Copy size={16} aria-hidden="true" /> Copiar</Button>
            <Button variant="primary" disabled={!whatsappUrl(adminPhone, messageDraft ?? '')} onClick={openWhatsApp}>
              <MessageCircle size={16} aria-hidden="true" /> Abrir no WhatsApp
            </Button>
          </>
        )}
      >
        <Field label="Mensagem (você pode editar antes de enviar)">
          {(id) => <textarea id={id} className="input" rows={8} value={messageDraft ?? ''} onChange={(event) => setMessageDraft(event.target.value)} />}
        </Field>
        {!whatsappUrl(adminPhone, messageDraft ?? '') && (
          <p className="field-hint">O WhatsApp do responsável ainda não está configurado. O participante pode copiar a mensagem; configure o contato em Configurações para habilitar a abertura do WhatsApp.</p>
        )}
      </Modal>
      {isBirthdayToday && birthdayCelebration > 0 && (
        <div className="participant-confetti-layer" key={birthdayCelebration} aria-hidden="true">
          {confettiPieces.map((piece, index) => (
            <span
              key={index}
              className={`participant-confetti-piece participant-confetti-shape-${piece.shape}`}
              style={{
                left: piece.left,
                '--confetti-delay': piece.delay,
                '--confetti-duration': piece.duration,
                '--confetti-drift': piece.drift,
                '--confetti-depth': piece.depth,
                '--confetti-width': piece.width,
                '--confetti-height': piece.height,
                '--confetti-color': piece.color,
              }}
            />
          ))}
        </div>
      )}
    </main>
  );
}
