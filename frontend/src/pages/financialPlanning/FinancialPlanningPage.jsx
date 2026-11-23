import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Calculator, CheckCircle2, Clock3, Save, Trash2, TrendingDown } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, EmptyState, ErrorState, Field, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { financialPlanningApi } from '../../services/api.js';
import { useLookups } from '../../hooks/useLookups.js';
import { money, parseMoney } from '../../lib/format.js';
import './FinancialPlanningPage.css';

const PAYMENT_LABELS = {
  dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', cartao_credito: 'Cartão de crédito',
  parcelamento_entrada: 'Parcelamento com entrada', outras: 'Outras modalidades',
};

const STATUS_LABELS = {
  planejada: 'Planejada', aprovada: 'Aprovada', descartada: 'Descartada', convertida: 'Convertida em compra real',
};

function todayValue() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function FinancialPlanningPage() {
  const lookups = useLookups();
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [personId, setPersonId] = useState('');
  const [form, setForm] = useState({
    nome: '', categoria: '', categoriaId: '', valorTotal: '', entrada: '0', quantidadeParcelas: '1',
    modalidadePagamento: 'cartao_credito', cartaoId: '', taxaJuros: '0', dataPrevista: todayValue(),
    horizonteProjecao: '12', observacoes: '',
  });
  const [analysis, setAnalysis] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event?.target ? event.target.value : event }));

  useEffect(() => {
    financialPlanningApi.people()
      .then((data) => {
        setPeople(data || []);
        if (data?.length) setPersonId((current) => current || String(data[0].id));
      })
      .catch((err) => setError(err?.message || 'Não foi possível carregar as pessoas'))
      .finally(() => setPeopleLoading(false));
  }, []);

  const reloadHistory = (pessoaId = personId) => {
    financialPlanningApi.simulations(pessoaId ? { pessoaId } : {})
      .then(setHistory)
      .catch((err) => setError(err?.message || 'Não foi possível carregar o histórico'));
  };

  useEffect(() => {
    if (personId) reloadHistory(personId);
  }, [personId]);

  const chartData = useMemo(() => (analysis?.projecao || []).map((item) => ({
    name: item.month,
    semCompra: item.withoutPurchase,
    comCompra: item.comWithPurchase,
  })), [analysis]);

  async function analyze(save = false) {
    if (!personId) return;
    setLoading(true);
    setError('');
    try {
      const data = await financialPlanningApi.project({
        pessoaId: personId,
        nome: form.nome.trim() || 'Compra simulada',
        categoria: form.categoria.trim(),
        categoriaId: form.categoriaId || null,
        valorTotal: parseMoney(form.valorTotal),
        entrada: parseMoney(form.entrada),
        quantidadeParcelas: Number(form.quantidadeParcelas),
        modalidadePagamento: form.modalidadePagamento,
        cartaoId: form.cartaoId || null,
        taxaJuros: Number(form.taxaJuros),
        dataPrevista: form.dataPrevista,
        horizonteProjecao: Number(form.horizonteProjecao),
        observacoes: form.observacoes,
        salvar: save,
      });
      setAnalysis(data);
      if (save) reloadHistory(personId);
    } catch (err) {
      setError(err?.message || 'Não foi possível calcular a simulação');
    } finally {
      setLoading(false);
    }
  }

  async function removeSimulation(id) {
    try {
      await financialPlanningApi.remove(id);
      reloadHistory(personId);
    } catch (err) {
      setError(err?.message || 'Não foi possível excluir a simulação');
    }
  }

  async function updateStatus(id, status) {
    try {
      await financialPlanningApi.updateStatus(id, status);
      reloadHistory(personId);
    } catch (err) {
      setError(err?.message || 'Não foi possível atualizar a simulação');
    }
  }

  async function convertSimulation(id) {
    if (!window.confirm('Converter esta simulação em compra real? Esta ação criará um lançamento financeiro real.')) return;
    try {
      await financialPlanningApi.convert(id);
      reloadHistory(personId);
    } catch (err) {
      setError(err?.message || 'Não foi possível converter a simulação');
    }
  }

  if (peopleLoading) return <Spinner />;

  return (
    <div className="financial-planning-page">
      <PageHeader title="Planejamento Financeiro" subtitle="Simule compras futuras sem alterar os dados financeiros reais." />

      {error && <ErrorState error={error} />}

      <div className="planning-person-row">
        <Field label="Pessoa analisada">
          {(id) => (
            <Select id={id} value={personId} onChange={(value) => setPersonId(value)}>
              <option value="">Selecione uma pessoa</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </Select>
          )}
        </Field>
      </div>

      <section className="planning-grid" aria-label="Simulador financeiro">
        <Card className="planning-form-card" title="Simulador de compras">
          <div className="planning-form-grid">
            <Field label="Nome da compra"><input className="input" value={form.nome} onChange={set('nome')} placeholder="Ex.: Ar-condicionado" /></Field>
            <Field label="Categoria"><Select value={form.categoriaId} onChange={(value) => {
              const category = lookups.categories.find((item) => String(item.id) === value);
              setForm((current) => ({ ...current, categoriaId: value, categoria: category?.name || '' }));
            }}><option value="">Sem categoria</option>{lookups.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Valor total"><input className="input" inputMode="decimal" value={form.valorTotal} onChange={set('valorTotal')} placeholder="R$ 0,00" /></Field>
            <Field label="Forma de pagamento"><Select value={form.modalidadePagamento} onChange={set('modalidadePagamento')}>{Object.entries(PAYMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
            <Field label="Valor de entrada"><input className="input" inputMode="decimal" value={form.entrada} onChange={set('entrada')} /></Field>
            <Field label="Parcelas"><input className="input" type="number" min="1" max="120" value={form.quantidadeParcelas} onChange={set('quantidadeParcelas')} /></Field>
            <Field label="Taxa de juros ao ano"><input className="input" inputMode="decimal" type="number" min="0" max="100" value={form.taxaJuros} onChange={set('taxaJuros')} /></Field>
            <Field label="Data prevista"><input className="input" type="date" value={form.dataPrevista} onChange={set('dataPrevista')} /></Field>
            {['cartao_credito', 'parcelamento_entrada'].includes(form.modalidadePagamento) && (
              <Field label="Cartão de crédito"><Select value={form.cartaoId} onChange={set('cartaoId')}><option value="">Selecione o cartão</option>{lookups.cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</Select></Field>
            )}
            <Field label="Horizonte"><Select value={form.horizonteProjecao} onChange={set('horizonteProjecao')}><option value="12">12 meses</option><option value="24">24 meses</option><option value="36">36 meses</option></Select></Field>
            <Field label="Observações"><textarea className="input" rows="3" value={form.observacoes} onChange={set('observacoes')} /></Field>
          </div>
          <div className="planning-actions">
            <Button onClick={() => analyze(false)} disabled={loading || !personId || !(parseMoney(form.valorTotal) > 0)}><Calculator aria-hidden="true" /> Calcular</Button>
            <Button variant="primary" onClick={() => analyze(true)} disabled={loading || !personId || !(parseMoney(form.valorTotal) > 0)}><Save aria-hidden="true" /> Salvar simulação</Button>
          </div>
        </Card>

        <Card className="planning-result-card" title="Resultado da simulação">
          {!analysis ? (
            <EmptyState title="Informe os dados da compra" />
          ) : (
            <>
              <div className={`planning-classification planning-${analysis.classificacao.codigo}`}>
                {analysis.classificacao.codigo === 'inviavel' ? <TrendingDown aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                <div><strong>{analysis.classificacao.titulo}</strong><p>{analysis.classificacao.motivo}</p></div>
              </div>
              <div className="planning-kpis">
                <Card><span>Saldo atual</span><strong>{money(analysis.saldoAtual)}</strong></Card>
                <Card><span>Sem a compra</span><strong>{money(analysis.saldoSemCompra)}</strong></Card>
                <Card><span>Com a compra</span><strong>{money(analysis.saldoComCompra)}</strong></Card>
                <Card><span>Impacto mensal</span><strong>{money(analysis.impactoMensal)}</strong></Card>
                <Card><span>Meses comprometidos</span><strong>{analysis.quantidadeMesesComprometidos}</strong></Card>
                <Card><span>Margem mínima</span><strong>{money(analysis.margemFinanceiraRestante)}</strong></Card>
              </div>
              <div className="planning-summary-lines">
                <span><Clock3 aria-hidden="true" /> Primeiro saldo negativo: <strong>{analysis.primeiroSaldoNegativo || 'Nenhum'}</strong></span>
                <span>Encerramento das parcelas: <strong>{analysis.dataEncerramentoParcelas || 'Não informado'}</strong></span>
                <span>Custo total estimado: <strong>{money(analysis.custoTotal)}</strong></span>
              </div>
              <div className="planning-chart" aria-label="Comparação dos cenários financeiros">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                    <Tooltip formatter={(value) => money(value)} />
                    <Bar dataKey="semCompra" name="Sem compra" fill="var(--chart-dim)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="comCompra" name="Com compra" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Card>
      </section>

      <Card className="planning-history-card" title="Histórico de simulações">
        {history.length === 0 ? <EmptyState title="Nenhuma simulação registrada" /> : (
          <div className="planning-history-list">
            {history.map((item) => (
              <article className="planning-history-item" key={item.id}>
                <div className="planning-history-main">
                  <span className="planning-history-icon"><BarChart3 aria-hidden="true" /></span>
                  <div><strong>{item.nome}</strong><small>{item.pessoa} · {item.quantidadeParcelas} parcela(s) · {money(item.valorTotal)}</small></div>
                </div>
                <div className="planning-history-meta">
                  <span>{PAYMENT_LABELS[item.modalidadePagamento] || item.modalidadePagamento}</span>
                  <span>{STATUS_LABELS[item.status] || item.status}</span>
                  <small>{new Date(item.createdAt).toLocaleDateString('pt-BR')}</small>
                </div>
                <div className="planning-history-actions">
                  {item.status !== 'convertida' && <Button size="sm" variant="primary" onClick={() => convertSimulation(item.id)}>Converter em compra</Button>}
                  {item.status !== 'aprovada' && item.status !== 'convertida' && <Button size="sm" onClick={() => updateStatus(item.id, 'aprovada')}>Aprovar</Button>}
                  {item.status !== 'descartada' && item.status !== 'convertida' && <Button size="sm" onClick={() => updateStatus(item.id, 'descartada')}>Descartar</Button>}
                  <Button size="sm" onClick={() => removeSimulation(item.id)} aria-label={`Excluir ${item.nome}`}><Trash2 aria-hidden="true" /></Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
