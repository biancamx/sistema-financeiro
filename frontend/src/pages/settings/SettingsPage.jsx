import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Pencil,
  Plus,
  ShieldCheck,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button, Card, Modal, PageHeader } from '../../components/ui/ui.jsx';
import { useAppBusy } from '../../context/BusyContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { notifyFinanceChanged } from '../../hooks/useFinanceRefresh.js';
import { MONTHS_SHORT, money } from '../../lib/format.js';
import { categoriesApi, importApi, systemApi } from '../../services/api.js';
import './SettingsPage.css';

const IMPORT_COUNT_CARDS = [
  ['Pessoas', (data) => data.people.length],
  ['Cartões', (data) => data.cards.length],
  ['Compras agrupadas', (data) => data.summaryCounts.purchasesCount],
  ['Parcelas no período', (data) => data.summaryCounts.installmentsCount],
  ['Linhas da planilha', (data) => data.summaryCounts.budgetLinesCount],
];
const PDF_IMPORT_COUNT_CARDS = [
  ['Pessoas', (data) => data.summaryCounts.peopleCount],
  ['Cartões', (data) => data.summaryCounts.cardsCount],
  ['Novas categorias', (data) => data.summaryCounts.newCategoriesCount],
  ['Compras parceladas', (data) => data.summaryCounts.installmentPurchasesCount],
  ['Recorrentes', (data) => data.summaryCounts.recurringCount],
  ['À vista', (data) => data.summaryCounts.oneTimeCount],
  ['Novas compras', (data) => data.deduplication?.newCount ?? data.summaryCounts.purchasesCount],
  ['Já existentes', (data) => data.deduplication?.existingCount ?? 0],
];
const pdfPeriodLabel = (month, year) => `${MONTHS_SHORT[month - 1]}/${year}`;

export default function SettingsPage() {
  const [previewData, setPreviewData] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [resetPhrase, setResetPhrase] = useState('');
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState(null);
  const [categoryToDelete, setCategoryToDelete] = useState(null);
  const [fileDragging, setFileDragging] = useState(false);
  const fileInput = useRef(null);
  const { begin, end } = useAppBusy();
  const toast = useToast();

  async function loadCategories() {
    setCategoriesLoading(true);
    try {
      setCategories(await categoriesApi.list());
    } catch (error) {
      toast.error(error);
    } finally {
      setCategoriesLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
    window.addEventListener('categories:refresh', loadCategories);
    return () => window.removeEventListener('categories:refresh', loadCategories);
  }, []);

  function openCategoryForm(category = null) {
    setCategoryForm(category
      ? { id: category.id, name: category.name, type: category.type, color: category.color, icon: category.icon }
      : { id: '', name: '', type: 'both', color: '#10b981', icon: 'Tag' });
  }

  async function saveCategory(event) {
    event.preventDefault();
    if (!categoryForm) return;
    const payload = {
      name: categoryForm.name.trim(),
      type: categoryForm.type,
      color: categoryForm.color,
      icon: categoryForm.icon.trim() || 'Tag',
    };
    begin(categoryForm.id ? 'Salvando categoria' : 'Criando categoria');
    try {
      if (categoryForm.id) await categoriesApi.update(categoryForm.id, payload);
      else await categoriesApi.create(payload);
      setCategoryForm(null);
      await loadCategories();
      toast.success(categoryForm.id ? 'Categoria atualizada.' : 'Categoria criada.');
    } catch (error) {
      toast.error(error);
    } finally {
      end();
    }
  }

  async function deleteCategory() {
    if (!categoryToDelete) return;
    begin('Excluindo categoria');
    try {
      await categoriesApi.remove(categoryToDelete.id);
      setCategoryToDelete(null);
      await loadCategories();
      toast.success('Categoria excluída.');
    } catch (error) {
      toast.error(error);
    } finally {
      end();
    }
  }

  async function analyzeImportFile(file) {
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    begin(file.name.toLowerCase().endsWith('.pdf') ? 'Analisando o PDF com Gemini' : 'Analisando sua planilha');

    try {
      const result = await importApi.previewDocument(formData);
      if (!result?.data?.people || !result?.data?.cards || !result?.data?.summaryCounts) {
        throw new Error('A API retornou uma prévia incompleta para este arquivo.');
      }
      setPreviewData(result.data);
    } catch (error) {
      toast.error(error);
    } finally {
      end();
    }
  }

  async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    await analyzeImportFile(file);
  }

  async function handleFileDrop(event) {
    event.preventDefault();
    setFileDragging(false);
    await analyzeImportFile(event.dataTransfer.files?.[0]);
  }

  async function handleConfirmImport() {
    if (!previewData) return;
    const analyzedData = previewData;
    setPreviewData(null);
    begin(analyzedData.sourceType === 'pdf' ? 'Gravando compras do PDF' : 'Importando os dados da planilha');
    try {
      const result = await importApi.executeSpreadsheet(analyzedData);
      const summary = result?.summary;
      if (!summary) throw new Error('A API não confirmou a importação.');
      setPreviewData(null);
      toast.success(analyzedData.sourceType === 'pdf'
        ? `Importação concluída: ${summary.peopleUpserted} novas pessoas, ${summary.cardsUpserted} novos cartões, ${summary.categoriesCreated} novas categorias, ${summary.purchasesUpserted} compras e ${summary.installmentsUpserted} parcelas${summary.purchasesIgnored ? `; ${summary.purchasesIgnored} duplicadas ignoradas` : ''}.`
        : `Importação concluída: ${summary.peopleUpserted} pessoas, ${summary.cardsUpserted} cartões, ${summary.purchasesUpserted} compras, ${summary.installmentsUpserted} parcelas e ${summary.budgetsUpserted} linhas.`);
      window.dispatchEvent(new Event('people:refresh'));
      window.dispatchEvent(new Event('cards:refresh'));
      window.dispatchEvent(new Event('categories:refresh'));
      notifyFinanceChanged();
      window.dispatchEvent(new Event('reminders:refresh'));
    } catch (error) {
      setPreviewData(analyzedData);
      toast.error(error);
    } finally {
      end();
    }
  }

  async function handleReset() {
    const resetPurchases = confirmation?.kind === 'purchases';
    begin(resetPurchases ? 'Limpando lançamentos' : 'Limpando os dados da conta');
    try {
      const result = resetPurchases
        ? await systemApi.resetPurchases()
        : await systemApi.resetAll();
      toast.success(result?.message || 'Dados removidos com sucesso.');
      setConfirmation(null);
      setResetPhrase('');
      window.dispatchEvent(new Event('reminders:refresh'));
    } catch (error) {
      toast.error(error);
    } finally {
      end();
    }
  }

  const resetAllConfirmed = confirmation?.kind !== 'all' || resetPhrase === 'RESETAR';

  return (
    <div className="settings-page">
      <PageHeader
        title="Configurações"
        subtitle="Importe planilhas e gerencie os dados da sua conta."
      />

      <Card className="settings-card">
        <header className="settings-card-head">
          <div className="settings-icon"><Tag aria-hidden="true" /></div>
          <div className="settings-card-copy">
            <h2>Categorias</h2>
            <p>Gerencie as categorias usadas nos lançamentos e filtros.</p>
          </div>
          {!categoriesLoading && <span className="settings-category-count">{categories.length} cadastradas</span>}
          <Button variant="primary" onClick={() => setCategoryManagerOpen(true)}>
            <Tag aria-hidden="true" /> Gerenciar
          </Button>
        </header>
      </Card>

      <Card className="settings-card">
        <header className="settings-card-head">
          <div className="settings-icon"><FileSpreadsheet aria-hidden="true" /></div>
          <div className="settings-card-copy">
            <h2>Importador de planilhas e faturas</h2>
            <p>Envie sua planilha ou fatura para conferir os dados antes de gravar.</p>
          </div>
        </header>

        <div
          className={`settings-upload${fileDragging ? ' is-dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setFileDragging(true); }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFileDragging(false);
          }}
          onDrop={handleFileDrop}
        >
          <Upload className="settings-upload-icon" aria-hidden="true" />
          <h3>Importe uma planilha ou fatura</h3>
          <p>Compatível com .xlsx, .xls e PDF de orçamento anual ou extrato de compras. O PDF é analisado pelo Google Gemini e só é gravado depois da sua conferência.</p>
          <Button
            variant="primary"
            className="settings-file-button"
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden="true" />
            Selecionar arquivo
          </Button>
          <input
            ref={fileInput}
            type="file"
            disabled={false}
            accept=".xlsx,.xls,.pdf,application/pdf"
            onChange={handleFileSelected}
            className="settings-file-input"
            aria-label="Selecionar planilha ou PDF financeiro"
          />
          <span className="settings-upload-hint">ou arraste o arquivo para esta área · máximo de 14 MB para PDF</span>
        </div>
      </Card>

      <Card className="settings-card settings-danger">
        <header className="settings-card-head">
          <div className="settings-icon settings-icon-danger"><Trash2 aria-hidden="true" /></div>
          <div className="settings-card-copy">
            <h2>Zona de perigo</h2>
            <p>Estas ações apagam dados da conta e exigem confirmação antes de continuar.</p>
          </div>
        </header>

        <div className="settings-reset-grid">
          <section className="settings-reset-option">
            <div>
              <h3>Limpar lançamentos</h3>
              <p>Apaga compras e parcelas, mantendo os cadastros de pessoas e cartões.</p>
            </div>
            <Button
              className="settings-button-warning"
              onClick={() => setConfirmation({ kind: 'purchases' })}
            >
              <Trash2 aria-hidden="true" />
              Limpar lançamentos
            </Button>
          </section>
          <section className="settings-reset-option settings-reset-option-danger">
            <div>
              <h3>Reset total da conta</h3>
              <p>Apaga compras, cartões, pessoas, planilhas e aniversários.</p>
            </div>
            <Button
              variant="primary"
              className="settings-button-danger"
              onClick={() => { setResetPhrase(''); setConfirmation({ kind: 'all' }); }}
            >
              <AlertTriangle aria-hidden="true" />
              Reset total
            </Button>
          </section>
        </div>
      </Card>

      <Modal
        open={categoryManagerOpen}
        title={categoryForm ? (categoryForm.id ? 'Editar categoria' : 'Nova categoria') : 'Gerenciar categorias'}
        wide
        className="settings-category-manager-modal"
        footer={(
          categoryForm
            ? (
              <>
                <Button onClick={() => setCategoryForm(null)}><X aria-hidden="true" /> Voltar</Button>
                <Button variant="primary" type="submit" form="settings-category-form">
                  <CheckCircle2 aria-hidden="true" /> Salvar categoria
                </Button>
              </>
            )
            : (
              <>
                <Button onClick={() => setCategoryManagerOpen(false)}>Fechar</Button>
                <Button variant="primary" onClick={() => openCategoryForm()}>
                  <Plus aria-hidden="true" /> Nova categoria
                </Button>
              </>
            )
        )}
      >
        {categoryForm ? (
          <form id="settings-category-form" className="settings-category-form" onSubmit={saveCategory}>
            <label className="field">
              <span className="field-label">Nome</span>
              <input className="input" value={categoryForm.name} maxLength={80} required onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Tipo</span>
              <select className="input" value={categoryForm.type} onChange={(event) => setCategoryForm({ ...categoryForm, type: event.target.value })}>
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
                <option value="both">Despesa e receita</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Cor</span>
              <span className="settings-category-color-picker">
                <input type="color" value={categoryForm.color} onChange={(event) => setCategoryForm({ ...categoryForm, color: event.target.value })} />
                <span>{categoryForm.color}</span>
              </span>
            </label>
          </form>
        ) : categoriesLoading ? (
          <p className="settings-loading">Carregando categorias...</p>
        ) : categories.length ? (
          <div className="settings-category-grid">
            {categories.map((category) => (
              <article className="settings-category" key={category.id}>
                <span className="settings-category-color" style={{ backgroundColor: category.color }} />
                <div className="settings-category-copy">
                  <strong>{category.name}</strong>
                  <span>{category.type === 'expense' ? 'Despesa' : category.type === 'income' ? 'Receita' : 'Despesa e receita'}</span>
                </div>
                <div className="settings-category-actions">
                  <button type="button" onClick={() => openCategoryForm(category)} aria-label={`Editar ${category.name}`} title="Editar">
                    <Pencil aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setCategoryToDelete(category)} aria-label={`Excluir ${category.name}`} title="Excluir">
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="settings-loading">Nenhuma categoria cadastrada.</p>
        )}
      </Modal>

      <Modal
        open={Boolean(categoryToDelete)}
        title="Excluir categoria"
        footer={(
          <>
            <Button onClick={() => setCategoryToDelete(null)}>Cancelar</Button>
            <Button variant="primary" className="settings-button-danger" onClick={deleteCategory}>
              <Trash2 aria-hidden="true" /> Excluir categoria
            </Button>
          </>
        )}
      >
        <p>Deseja excluir a categoria <strong>{categoryToDelete?.name}</strong>? Categorias vinculadas a lançamentos não podem ser excluídas.</p>
      </Modal>

      <Modal
        open={Boolean(previewData)}
        title={previewData?.documentLabel
          ?? (previewData?.sourceType === 'pdf' ? 'Conferir compras do PDF' : 'Conferir importação')}
        wide
        footer={(
          <>
            <Button onClick={() => setPreviewData(null)}><X aria-hidden="true" /> Cancelar</Button>
            <Button
              variant="primary"
              onClick={handleConfirmImport}
              disabled={previewData?.sourceType === 'pdf' && (previewData.pdfIssues.length > 0 || previewData.pdfRecords.length === 0)}
            >
              Confirmar e importar <ArrowRight aria-hidden="true" />
            </Button>
          </>
        )}
      >
        {previewData && (
          <div className="settings-preview">
            {previewData.documentLabel && (
              <section className="settings-pdf-new-entities">
                <h3>Tipo de documento detectado</h3>
                <p>{previewData.documentLabel}</p>
                {previewData.deduplication && (
                  <p>
                    Novos: {previewData.deduplication.newCount} · Já existentes (serão atualizados ou ignorados): {previewData.deduplication.existingCount}
                  </p>
                )}
                {previewData.newEntities?.people?.length > 0 && (
                  <small>Novas pessoas: {previewData.newEntities.people.join(', ')}</small>
                )}
              </section>
            )}
            <p className="muted">
              {previewData.sourceType === 'pdf'
                ? 'Confira as compras reconhecidas e os vínculos com seus cadastros. O PDF é enviado ao Google Gemini para análise; nenhum dado será gravado até confirmar.'
                : 'Revise os dados detectados. A gravação atualiza registros existentes sem duplicá-los.'}
            </p>
            <div className="settings-count-grid">
              {(previewData.sourceType === 'pdf' ? PDF_IMPORT_COUNT_CARDS : IMPORT_COUNT_CARDS).map(([label, count]) => (
                <div className="settings-count" key={label}>
                  <span>{label}</span>
                  <strong>{count(previewData)}</strong>
                </div>
              ))}
            </div>
            {previewData.sourceType === 'pdf' && (
              <>
                {previewData.pdfIssues.length > 0 && (
                  <section className="settings-pdf-issues" role="alert">
                    <h3><AlertTriangle aria-hidden="true" /> Itens que precisam de atenção</h3>
                    <p>Confira os dados essenciais que não puderam ser identificados com segurança. A importação será liberada quando não houver pendências.</p>
                    <ul>{previewData.pdfIssues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>
                  </section>
                )}
                {(() => {
                  const newEntities = previewData.newEntities ?? { people: [], cards: [], categories: [] };
                  const records = previewData.pdfRecords;
                  return (
                    <section className="settings-pdf-new-entities">
                      <h3>✨ Novos cadastros que serão criados</h3>
                      <p>
                        {newEntities.people.length} pessoas, {newEntities.cards.length} cartões e {newEntities.categories.length} categorias.
                      </p>
                      <p>
                        📦 Compras identificadas: {records.filter((record) => record.kind === 'installment').length} parceladas,{' '}
                        {records.filter((record) => record.kind === 'recurring').length} recorrentes e{' '}
                        {records.filter((record) => record.kind === 'oneTime').length} à vista.
                      </p>
                      {[
                        ['Pessoas', newEntities.people],
                        ['Cartões', newEntities.cards],
                        ['Categorias', newEntities.categories],
                      ].filter(([, names]) => names.length > 0).map(([label, names]) => (
                        <small key={label}>{label}: {names.join(', ')}</small>
                      ))}
                    </section>
                  );
                })()}
                {previewData.pdfRecords.length > 0 && (
                  <section className="settings-pdf-records">
                    <h3>Compras encontradas ({previewData.pdfRecords.length})</h3>
                    <ul>
                      {previewData.pdfRecords.map((record, index) => {
                        const kind = record.kind === 'installment' ? 'Parcelada'
                          : record.kind === 'recurring' ? 'Recorrente' : 'À vista';
                        const value = record.totalAmount;
                        const detail = record.kind === 'installment'
                          ? `${record.totalInstallments}x de ${money(record.installmentAmount || record.totalAmount / record.totalInstallments)} · ${pdfPeriodLabel(record.startMonth, record.startYear)}–${pdfPeriodLabel(record.endMonth, record.endYear)}`
                          : record.kind === 'recurring'
                            ? `${pdfPeriodLabel(record.startMonth, record.startYear)}–${record.endMonth ? pdfPeriodLabel(record.endMonth, record.endYear) : 'contínua'} · ${money(record.totalAmount)}/mês`
                            : pdfPeriodLabel(record.startMonth, record.startYear);
                        return (
                          <li key={`${record.description}-${index}`}>
                            <span className="settings-pdf-record-copy">
                              <strong>{record.description}</strong>
                              <small>{kind} · {record.participants.map((participant) => (
                                `${participant.personName} (${money(participant.allocatedTotal)}${participant.alreadyExists ? ' · já existe' : ''})`
                              )).join(', ')} · {record.cardName}</small>
                              <small>Categoria: {record.categoryName || '—'}</small>
                              <small>{detail}</small>
                            </span>
                            <strong>{money(value)}</strong>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                {previewData.pdfRecords.length === 0 && previewData.pdfIssues.length === 0 && (
                  <p className="settings-pdf-empty">Nenhuma compra foi identificada neste PDF.</p>
                )}
              </>
            )}
            <section className="settings-check">
              <h3><ShieldCheck aria-hidden="true" /> {previewData.sourceType === 'pdf' ? 'Divergências de valores' : 'Conferência dos totais'}</h3>
              {(previewData.sourceType === 'pdf' ? previewData.pdfDivergences : previewData.divergences).length === 0 ? (
                <p className="settings-check-ok"><CheckCircle2 aria-hidden="true" />
                  {previewData.sourceType === 'pdf'
                    ? 'Não foram detectadas divergências entre o total da compra e as parcelas.'
                    : 'Os totais das abas mensais conferem.'}
                </p>
              ) : (
                <ul className="settings-divergences">
                  {(previewData.sourceType === 'pdf' ? previewData.pdfDivergences : previewData.divergences).map((divergence, index) => (
                    <li key={`${divergence.section}-${index}`}>
                      <strong>{previewData.sourceType === 'pdf' ? divergence.description : divergence.section}</strong>
                      <span>{previewData.sourceType === 'pdf'
                        ? `Total: ${money(divergence.expectedTotal)} · Parcela × quantidade: ${money(divergence.installmentsTotal)}`
                        : `Planilha: ${divergence.sheetTotal} · Calculado: ${divergence.calculatedTotal}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(confirmation)}
        title={confirmation?.kind === 'all' ? 'Confirmar reset total' : 'Confirmar limpeza'}
        footer={(
          <>
            <Button onClick={() => { setConfirmation(null); setResetPhrase(''); }}>Cancelar</Button>
            <Button variant="primary" className="settings-button-danger" disabled={!resetAllConfirmed} onClick={handleReset}>
              <Trash2 aria-hidden="true" /> Confirmar exclusão
            </Button>
          </>
        )}
      >
        {confirmation?.kind === 'all' ? (
          <div className="settings-confirm-copy">
            <p>Esta ação é permanente e remove os dados da conta. Para confirmar, digite <strong>RESETAR</strong>.</p>
            <label className="field">
              <span className="field-label">Confirmação</span>
              <input className="input" value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} autoComplete="off" />
            </label>
          </div>
        ) : (
          <p>Tem certeza que deseja apagar todos os lançamentos e parcelas? Pessoas e cartões serão mantidos.</p>
        )}
      </Modal>
    </div>
  );
}
