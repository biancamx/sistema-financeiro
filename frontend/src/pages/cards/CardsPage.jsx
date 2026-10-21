import { useState } from 'react';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { notifyFinanceChanged, useFinanceRefresh } from '../../hooks/useFinanceRefresh.js';
import { cardsApi, peopleApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Field, Modal, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { monthLabel, parseMoney } from '../../lib/format.js';

const templates = {
  'Nubank': '#820ad1',
  'Inter': '#f36f21',
  'C6 Bank': '#202020',
  'Santander': '#ec0000',
  'Itaú': '#123b8b',
  'Bradesco': '#cc092f',
  'Banco do Brasil': '#f5c400',
  'Visa': '#1a1f71',
  'Mastercard': '#242424',
  'Elo': '#172c62',
  'Outro': '#0f6b66',
};
const issuerOptions = Object.keys(templates).map((name) => ({ value: name, label: name }));
const brandOptions = ['Visa', 'Mastercard', 'Elo', 'American Express', 'Outro'].map((name) => ({ value: name, label: name }));
const emptyCard = { name: '', limit: '', issuer: 'Outro', brand: 'Outro', lastFour: '', color: templates.Outro, imageData: null, ownerId: '', dueDay: '10', closingDay: '3', closingDayEqual: 'next' };
const usageTone = (percent, limit) => {
  if (limit <= 0) return 'green';
  const pct = Math.round(percent);
  return pct <= 50 ? 'green' : pct <= 80 ? 'yellow' : 'red';
};

function processCardImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem');
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('O arquivo selecionado não é uma imagem válida.'));
      image.onload = () => {
        const targetWidth = 856;
        const targetHeight = 540;
        const targetRatio = targetWidth / targetHeight;
        let sourceWidth = image.width;
        let sourceHeight = image.height;
        let sourceX = 0;
        let sourceY = 0;
        const currentRatio = sourceWidth / sourceHeight;

        if (currentRatio > targetRatio) {
          sourceWidth = sourceHeight * targetRatio;
          sourceX = (image.width - sourceWidth) / 2;
        } else {
          sourceHeight = sourceWidth / targetRatio;
          sourceY = (image.height - sourceHeight) / 2;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Não foi possível processar a imagem.'));
          return;
        }

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
        for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42]) {
          const imageData = canvas.toDataURL('image/jpeg', quality);
          if (imageData.length <= 80_000) {
            resolve(imageData);
            return;
          }
        }
        reject(new Error('A imagem ficou muito grande. Escolha uma arte com menos detalhes ou cores.'));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function CardsPage() {
  const { month, year } = usePeriod();
  const toast = useToast();
  const { data, error, reload } = useFetch(() => cardsApi.list({ month, year, withImages: true }), [month, year]);
  useFinanceRefresh(reload);
  const people = useFetch(() => peopleApi.list(), []);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (people.error) return <ErrorState error={people.error} onRetry={people.reload} />;
  if (!data || !people.data) return <Spinner />;

  const save = async (form) => {
    const body = {
      name: form.name.trim(),
      limit: parseMoney(form.limit),
      issuer: form.issuer,
      brand: form.brand,
      lastFour: form.lastFour || null,
      color: form.color,
      imageData: form.imageData || null,
      ownerId: form.ownerId ? Number(form.ownerId) : null,
      dueDay: Number.parseInt(form.dueDay, 10) || 10,
      closingDay: Number.parseInt(form.closingDay, 10) || 3,
      closingDayEqual: form.closingDayEqual || 'next',
    };
    if (!body.name || Number.isNaN(body.limit)) return toast.error(new Error('Preencha o nome e um limite válido'));
    try {
      if (form.id) await cardsApi.update(form.id, body);
      else await cardsApi.create(body);
      notifyFinanceChanged();
      toast.success('Cartão salvo');
      setEditing(null);
      reload();
    } catch (e) { toast.error(e); }
  };
  const remove = async (card) => {
    if (!window.confirm(`Excluir "${card.name}"? As compras feitas nele também serão apagadas.`)) return;
    try { await cardsApi.remove(card.id); notifyFinanceChanged(); toast.success('Cartão excluído'); reload(); } catch (e) { toast.error(e); }
  };
  const editCard = (card) => setEditing({
    id: card.id,
    name: card.name,
    limit: String(card.limit).replace('.', ','),
    issuer: card.issuer || 'Outro',
    brand: card.brand || 'Outro',
    lastFour: card.lastFour || '',
    color: card.color || templates.Outro,
    imageData: card.imageData || null,
    ownerId: card.ownerId ? String(card.ownerId) : '',
    dueDay: card.dueDay ? String(card.dueDay) : '10',
    closingDay: card.closingDay ? String(card.closingDay) : '3',
    closingDayEqual: card.closingDayEqual || 'next',
  });
  const setIssuer = (issuer) => setEditing((card) => ({ ...card, issuer, color: templates[issuer] }));
  const setImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imageData = await processCardImage(file);
      setEditing((card) => ({ ...card, imageData }));
    } catch (e) { toast.error(e); }
    event.target.value = '';
  };
  const payInvoice = async () => {
    const amount = parseMoney(paying.amount);
    if (!(amount > 0) || amount > paying.invoice) return toast.error(new Error('Informe um pagamento maior que zero e até o valor da fatura'));
    try {
      await cardsApi.payInvoice(paying.id, { month, year, amount });
      notifyFinanceChanged();
      toast.success('Pagamento registrado; limite atualizado');
      setPaying(null);
      reload();
    } catch (e) { toast.error(e); }
  };

  const totalsCents = data.reduce((sum, card) => ({
    used: sum.used + Math.round(card.used * 100),
    available: sum.available + Math.round(card.available * 100),
  }), { used: 0, available: 0 });
  const totals = { used: totalsCents.used / 100, available: totalsCents.available / 100 };

  return (
    <>
      <PageHeader title="Cartões" subtitle={`Limite disponível considera parcelas não pagas de ${monthLabel(month, year)} em diante`} actions={<Button variant="primary" onClick={() => setEditing({ ...emptyCard })}>Novo cartão</Button>} />
      <div className="cards-summary">
        <Card><span className="muted">Limite utilizado</span><strong><Money value={totals.used} /></strong></Card>
        <Card><span className="muted">Limite disponível</span><strong><Money value={totals.available} tone={totals.available < 0 ? 'neg' : 'pos'} /></strong></Card>
        <Card><span className="muted">Cartões cadastrados</span><strong>{data.length}</strong></Card>
      </div>
      {data.length === 0 ? (
        <Card><EmptyState title="Nenhum cartão ainda">Cadastre seus cartões para acompanhar o limite e registrar compras.</EmptyState></Card>
      ) : (
        <section className="card-grid" aria-label="Seus cartões">
          {data.map((card) => {
            const percent = card.percentUsed;
            const tone = usageTone(percent, card.limit);
            return (
              <article className="managed-card" key={card.id}>
                <div className="managed-card-face" style={{ backgroundColor: card.color || templates.Outro }}>
                  {card.imageData && <img className="managed-card-image" src={card.imageData} alt="" />}
                  {card.imageData && <div className="managed-card-shade" />}
                  <div className="managed-card-content">
                    <div className="managed-card-top">
                      <span>{card.issuer !== 'Outro' ? card.issuer : card.name}</span>
                      {card.brand && card.brand !== 'Outro' && <span className="managed-card-network">{card.brand}</span>}
                    </div>
                    {!card.imageData && <div className="managed-card-chip" aria-hidden="true"><span /></div>}
                    <div className="card-digits">•••• •••• •••• {card.lastFour || '••••'}</div>
                    <div className="managed-card-bottom">
                      <div className="managed-card-holder">
                        <small>Titular</small>
                        <strong>{card.owner || 'Titular não definido'}</strong>
                      </div>
                      <div className="managed-card-identification">
                        <small>Identificação</small>
                        <span>{card.name}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="managed-card-details">
                  <div className="card-billing-days">
                    <span>Fecha dia <strong>{card.closingDay || '—'}</strong></span>
                    <span aria-hidden="true">·</span>
                    <span>Vence dia <strong>{card.dueDay || 10}</strong></span>
                  </div>
                  <div className="card-limit-heading"><span>Uso do limite</span><strong className={`usage-${tone}`}>{card.limit > 0 ? `${percent.toFixed(0)}%` : 'Sem limite'}</strong></div>
                  {card.limit > 0 && (
                    <div className="limit-progress" role="progressbar" aria-label={`Limite utilizado no cartão ${card.name}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, percent)} aria-valuetext={`${percent.toFixed(0)}% utilizado`}>
                      <div className={`limit-progress-fill usage-bg-${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
                    </div>
                  )}
                  <div className="limit-values">
                    <span><small>Utilizado</small><Money value={card.used} /></span>
                    <span><small>Disponível</small>{card.limit > 0 ? <Money value={card.available} tone={card.available < 0 ? 'neg' : 'pos'} /> : <span className="muted">Sem limite</span>}</span>
                  </div>
                  <div className="card-invoice">
                    <span>Fatura em aberto · {monthLabel(month, year)}{card.invoiceDueDate ? ` · vence ${card.invoiceDueDate.split('-').reverse().join('/')}` : ''}</span>
                    <Money value={card.invoice} strong />
                    {card.invoice > 0 && <Button variant="ghost" size="sm" onClick={() => setPaying({ id: card.id, name: card.name, invoice: card.invoice, amount: String(card.invoice).replace('.', ',') })}>Pagar</Button>}
                  </div>
                  <div className="card-actions"><Button variant="ghost" size="sm" onClick={() => editCard(card)}>Editar</Button><Button variant="ghost" size="sm" onClick={() => remove(card)}>Excluir</Button></div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <Modal open={!!editing} title={editing?.id ? 'Editar cartão' : 'Novo cartão'} onClose={() => setEditing(null)} wide
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" onClick={() => save(editing)}>Salvar cartão</Button></>}>
        {editing && (
          <div className="form-grid">
            <Field label="Nome do cartão">{(id) => <input id={id} className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus placeholder="Ex.: Cartão principal" />}</Field>
            <Field label="Titular principal" hint="As compras podem continuar sendo atribuídas a outras pessoas.">{(id) => <Select id={id} value={editing.ownerId} onChange={(value) => setEditing({ ...editing, ownerId: value })} placeholder="Selecione um titular" options={people.data.map((person) => ({ value: person.id, label: person.name }))} />}</Field>
            <Field label="Banco / modelo visual">{(id) => <Select id={id} value={editing.issuer} onChange={setIssuer} options={issuerOptions} />}</Field>
            <Field label="Bandeira">{(id) => <Select id={id} value={editing.brand} onChange={(brand) => setEditing({ ...editing, brand })} options={brandOptions} />}</Field>
            <Field label="Últimos 4 dígitos" hint="Não informe o número completo do cartão.">{(id) => <input id={id} className="input" inputMode="numeric" autoComplete="off" maxLength={4} pattern="\d{4}" placeholder="4821" value={editing.lastFour} onChange={(e) => setEditing({ ...editing, lastFour: e.target.value.replace(/\D/g, '').slice(0, 4) })} />}</Field>
            <Field label="Limite total (R$)" hint="Use 0 se não quiser controlar o limite">{(id) => <input id={id} className="input" inputMode="decimal" value={editing.limit} onChange={(e) => setEditing({ ...editing, limit: e.target.value })} />}</Field>
            <Field label="Dia do fechamento" hint="Dia que fecha a fatura do cartão.">{(id) => <input id={id} className="input" type="number" min="1" max="31" value={editing.closingDay} onChange={(e) => setEditing({ ...editing, closingDay: e.target.value })} />}</Field>
            <Field label="Compra no dia do fechamento" hint="Como a compra é classificada quando cai exatamente no fechamento?">{(id) => <Select id={id} value={editing.closingDayEqual} onChange={(closingDayEqual) => setEditing({ ...editing, closingDayEqual })} options={[{ value: 'next', label: 'Próxima fatura (padrão)' }, { value: 'current', label: 'Fatura que fecha neste mês' }]} />}</Field>
            <Field label="Dia do vencimento" hint="Dia do pagamento da fatura.">{(id) => <input id={id} className="input" type="number" min="1" max="31" required value={editing.dueDay} onChange={(e) => setEditing({ ...editing, dueDay: e.target.value })} />}</Field>
            <Field label="Cor do cartão">{(id) => <div className="card-color-input"><input id={id} type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} /><span>{editing.color}</span></div>}</Field>
            <Field label="Foto ou arte do cartão" hint="A imagem é redimensionada antes de ser salva.">{(id) => <input id={id} className="input" type="file" accept="image/*" onChange={setImage} />}</Field>
            {editing.imageData && <div className="card-image-control"><span>Imagem personalizada adicionada.</span><Button variant="ghost" size="sm" onClick={() => setEditing({ ...editing, imageData: null })}>Remover imagem</Button></div>}
          </div>
        )}
      </Modal>
      <Modal open={!!paying} title={`Pagar fatura · ${paying?.name || ''}`} onClose={() => setPaying(null)}
        footer={<><Button variant="ghost" onClick={() => setPaying(null)}>Cancelar</Button><Button variant="primary" onClick={payInvoice}>Registrar pagamento</Button></>}>
        {paying && (
          <div className="form-grid">
            <Field label="Valor em aberto">{(id) => <output id={id} className="payment-balance"><Money value={paying.invoice} strong /></output>}</Field>
            <Field label="Valor do pagamento (R$)" hint="Um pagamento parcial libera o limite proporcionalmente.">{(id) => <input id={id} className="input" inputMode="decimal" value={paying.amount} onChange={(e) => setPaying({ ...paying, amount: e.target.value })} autoFocus />}</Field>
          </div>
        )}
      </Modal>
    </>
  );
}
