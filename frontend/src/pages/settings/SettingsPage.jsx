// Copyright © 2026 Bianca Moura. Todos os direitos reservados.
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BadgeInfo,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { version } from '../../../package.json';
import { Button, Card, Field, Modal, PageHeader } from '../../components/ui/ui.jsx';
import { useAppBusy } from '../../context/BusyContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { notifyFinanceChanged } from '../../hooks/useFinanceRefresh.js';
import { refreshAllLookups } from '../../services/lookupRefresh.js';
import { MONTHS_SHORT, money } from '../../lib/format.js';
import { categoriesApi, importApi, settingsAiApi, systemApi, vehiclesApi } from '../../services/api.js';
import PushNotificationsSettings from './PushNotificationsSettings.jsx';
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
const SETTINGS_TABS = ['categories', 'import', 'ai', 'vehicle-reminders', 'push', 'about', 'danger'];
const pdfPeriodLabel = (month, year) => `${MONTHS_SHORT[month - 1]}/${year}`;

function SettingsPanels({ standaloneImport, open, title, onClose, footer, children }) {
  const panels = <div className="settings-sections">{children}</div>;
  if (standaloneImport) return panels;
  return (
    <Modal
      open={open}
      title={title}
      className="settings-dialog"
      onClose={onClose}
      dismissible
      footer={footer}
    >
      {panels}
    </Modal>
  );
}

export default function SettingsPage({ initialSection = 'categories', standaloneImport = false } = {}) {
  const [activeSection, setActiveSection] = useState(initialSection);
  const [previewData, setPreviewData] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [resetPhrase, setResetPhrase] = useState('');
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [categoryPdfPreview, setCategoryPdfPreview] = useState(null);
  const [categoryForm, setCategoryForm] = useState(null);
  const [categoryToDelete, setCategoryToDelete] = useState(null);
  const [fileDragging, setFileDragging] = useState(false);
  const [aiSettings, setAiSettings] = useState(null);
  const [aiProviders, setAiProviders] = useState({});
  const [aiProvider, setAiProvider] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [showAiApiKey, setShowAiApiKey] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [aiMessage, setAiMessage] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiLoading, setAiLoading] = useState(true);
  const [removeAiConfirmation, setRemoveAiConfirmation] = useState(false);
  const [vehicleReminderSettings, setVehicleReminderSettings] = useState({ daysBefore: 30, kmBefore: 500 });
  const [vehicleReminderSettingsLoading, setVehicleReminderSettingsLoading] = useState(true);
  const [vehicleReminderSettingsBusy, setVehicleReminderSettingsBusy] = useState(false);
  const fileInput = useRef(null);
  const categoryPdfInput = useRef(null);
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

  useEffect(() => {
    vehiclesApi.reminderSettings()
      .then(setVehicleReminderSettings)
      .catch((error) => toast.error(error))
      .finally(() => setVehicleReminderSettingsLoading(false));
  }, []);

  async function saveVehicleReminderSettings(event) {
    event.preventDefault();
    setVehicleReminderSettingsBusy(true);
    try {
      const saved = await vehiclesApi.saveReminderSettings({
        daysBefore: Number(vehicleReminderSettings.daysBefore),
        kmBefore: Number(vehicleReminderSettings.kmBefore),
      });
      setVehicleReminderSettings(saved);
      toast.success('Antecedência dos lembretes atualizada.');
      setActiveSection('categories');
    } catch (error) {
      toast.error(error);
    } finally {
      setVehicleReminderSettingsBusy(false);
    }
  }

  useEffect(() => {
    settingsAiApi.get()
      .then((settings) => {
        setAiSettings(settings);
        setAiProviders(settings.providers ?? {});
        const provider = settings.provider ?? Object.keys(settings.providers ?? {})[0] ?? '';
        setAiProvider(provider);
        setAiModel(settings.model ?? settings.providers?.[provider]?.models?.[0] ?? '');
        setAiConsent(settings.consentGiven);
      })
      .catch((error) => toast.error(error))
      .finally(() => setAiLoading(false));
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
      toast.success('Categoria excluída.');
    } catch (error) {
      toast.error(error);
    } finally {
      end();
    }
  }

  async function handleCategoryPdfSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error(new Error('Selecione um arquivo PDF.'));
      return;
    }
    if (!aiSettings?.configured || !aiSettings.consentGiven) {
      toast.error(new Error('Configure sua chave e confirme o envio de dados na seção Inteligência artificial antes de analisar PDFs.'));
      if (!standaloneImport) setActiveSection('ai');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    begin('Analisando categorias no PDF com sua IA');
    try {
      const result = await categoriesApi.previewPdfImport(formData);
      if (!Array.isArray(result?.data?.newCategories) || !Array.isArray(result?.data?.alreadyExists)) {
        throw new Error('A API retornou uma prévia inválida para este PDF.');
      }
      setCategoryPdfPreview(result.data);
    } catch (error) {
      toast.error(error);
    } finally {
      end();
    }
  }

  async function handleConfirmCategoryPdfImport() {
    if (!categoryPdfPreview?.newCategories?.length) return;
    begin('Importando categorias');
    try {
      const result = await categoriesApi.importNames(categoryPdfPreview.newCategories);
      setCategoryPdfPreview(null);
      toast.success(`${result.createdCount} ${result.createdCount === 1 ? 'categoria importada' : 'categorias importadas'}.`);
    } catch (error) {
      toast.error(error);
    } finally {
      end();
    }
  }

  async function analyzeImportFile(file) {
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.pdf')
      && (!aiSettings?.configured || !aiSettings.consentGiven)) {
      const message = 'Configure sua chave e confirme o envio de dados na seção Inteligência artificial antes de analisar PDFs.';
      toast.error(new Error(standaloneImport
        ? `${message} Acesse Mais > Configurações > Inteligência artificial para configurar.`
        : message));
      if (!standaloneImport) setActiveSection('ai');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    begin(file.name.toLowerCase().endsWith('.pdf') ? 'Analisando o PDF com sua IA' : 'Analisando sua planilha');

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
      if (!standaloneImport) setActiveSection('categories');
      refreshAllLookups();
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
      if (!resetPurchases) refreshAllLookups();
      window.dispatchEvent(new Event('reminders:refresh'));
    } catch (error) {
      toast.error(error);
    } finally {
      end();
    }
  }

  function handleAiProviderChange(event) {
    const provider = event.target.value;
    setAiProvider(provider);
    setAiModel(aiProviders[provider]?.models?.[0] ?? '');
    setAiApiKey('');
    setAiMessage(null);
  }

  function validateAiForm({ requireKey = true } = {}) {
    if (requireKey && !aiApiKey.trim()) {
      setAiMessage({ text: 'Informe a chave de API para continuar.', type: 'error' });
      return false;
    }
    if (!aiConsent) {
      setAiMessage({ text: 'Confirme o aviso sobre o envio de dados ao provedor.', type: 'error' });
      return false;
    }
    return true;
  }

  async function handleAiConsentChange(event) {
    const consent = event.target.checked;
    if (!aiSettings?.configured) {
      setAiConsent(consent);
      return;
    }

    setAiBusy(true);
    try {
      const result = await settingsAiApi.setConsent(consent);
      setAiConsent(result.consentGiven);
      setAiSettings({ ...aiSettings, consentGiven: result.consentGiven });
      setAiMessage({
        text: result.consentGiven
          ? 'Consentimento ativado para o provedor selecionado.'
          : 'Consentimento removido. O assistente e a análise de PDFs foram desativados.',
        type: 'success',
      });
    } catch (error) {
      setAiMessage({ text: error.message, type: 'error' });
    } finally {
      setAiBusy(false);
    }
  }

  async function testAiKey() {
    if (!validateAiForm()) return;
    setAiBusy(true);
    setAiMessage({ text: 'Testando a chave...', type: 'pending' });
    try {
      await settingsAiApi.test({ provider: aiProvider, model: aiModel, apiKey: aiApiKey.trim() });
      setAiMessage({ text: 'Chave válida para o provedor e modelo selecionados.', type: 'success' });
    } catch (error) {
      setAiMessage({ text: error.message, type: 'error' });
    } finally {
      setAiBusy(false);
    }
  }

  async function saveAiKey() {
    const needsNewKey = !aiSettings?.configured || aiSettings.provider !== aiProvider;
    if (!validateAiForm({ requireKey: needsNewKey })) return;
    setAiBusy(true);
    setAiMessage({ text: 'Salvando a chave...', type: 'pending' });
    try {
      const saved = await settingsAiApi.save({
        provider: aiProvider,
        model: aiModel,
        ...(aiApiKey.trim() && { apiKey: aiApiKey.trim() }),
        consent: aiConsent,
      });
      setAiSettings(saved);
      setAiProviders(saved.providers ?? aiProviders);
      setAiApiKey('');
      setAiMessage({ text: 'Configuração de IA salva com segurança.', type: 'success' });
      setActiveSection('categories');
    } catch (error) {
      setAiMessage({ text: error.message, type: 'error' });
    } finally {
      setAiBusy(false);
    }
  }

  async function removeAiKey() {
    setAiBusy(true);
    try {
      await settingsAiApi.remove();
      setAiSettings({ configured: false, provider: null, model: null, last4: null, consentGiven: false });
      setAiApiKey('');
      setAiConsent(false);
      setRemoveAiConfirmation(false);
      setAiMessage({ text: 'Chave removida. O assistente e a análise de PDFs foram desativados.', type: 'success' });
    } catch (error) {
      setAiMessage({ text: error.message, type: 'error' });
    } finally {
      setAiBusy(false);
    }
  }

  const resetAllConfirmed = confirmation?.kind !== 'all' || resetPhrase === 'RESETAR';
  const aiEnabled = aiSettings?.configured && aiSettings?.consentGiven;

  function handleSettingsTabKeyDown(event) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    const currentIndex = SETTINGS_TABS.indexOf(activeSection);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? SETTINGS_TABS.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    const nextSection = SETTINGS_TABS[nextIndex];
    setActiveSection(nextSection);
    document.getElementById(`settings-tab-${nextSection}`)?.focus();
  }

  const closeSettingsModal = () => setActiveSection('categories');
  const importForm = (
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
        <p>Compatível com .xlsx, .xls e PDF de orçamento anual ou extrato de compras. O PDF é analisado pela IA configurada na sua conta e só é gravado depois da sua conferência.</p>
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
  );
  const aiForm = (
    <Card className="settings-card">
      <header className="settings-card-head">
        <div className="settings-icon"><Sparkles aria-hidden="true" /></div>
        <div className="settings-card-copy">
          <h2>Sua chave de IA</h2>
          <p>Use sua própria chave do Google Gemini, OpenAI ou Anthropic Claude.</p>
        </div>
        <span className={`settings-ai-status${aiEnabled ? ' is-active' : ''}`} role="status">
          <span className="settings-ai-status-dot" />
          {aiLoading ? 'Carregando' : aiEnabled ? 'Ativa' : aiSettings?.configured ? 'Consentimento pendente' : 'Sem chave'}
        </span>
      </header>

      <div className="settings-ai-fields">
        <label className="field">
          <span className="field-label">Provedor</span>
          <select className="input" value={aiProvider} onChange={handleAiProviderChange} disabled={aiLoading || aiBusy}>
            {Object.entries(aiProviders).map(([id, provider]) => (
              <option key={id} value={id}>{provider.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Modelo</span>
          <select className="input" value={aiModel} onChange={(event) => setAiModel(event.target.value)} disabled={aiLoading || aiBusy || !aiProvider}>
            {(aiProviders[aiProvider]?.models ?? []).map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </label>
        <label className="field settings-ai-key-field">
          <span className="field-label">Chave de API</span>
          <span className="settings-ai-key-input">
            <input
              className="input"
              type={showAiApiKey ? 'text' : 'password'}
              autoComplete="new-password"
              spellCheck="false"
              value={aiApiKey}
              onChange={(event) => setAiApiKey(event.target.value)}
              placeholder={aiSettings?.configured ? 'Chave salva não é exibida. Informe outra para substituir.' : 'Cole sua chave de API'}
              disabled={aiBusy}
            />
            <button
              type="button"
              className="settings-ai-eye"
              onClick={() => setShowAiApiKey((visible) => !visible)}
              aria-label={showAiApiKey ? 'Ocultar chave' : 'Mostrar chave'}
            >
              {showAiApiKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </span>
          <span className="field-hint">{aiProviders[aiProvider]?.hint}</span>
        </label>
      </div>

      {aiSettings?.configured && (
        <div className="settings-ai-saved" role="status">
          <KeyRound aria-hidden="true" />
          <span>{aiProviders[aiSettings.provider]?.label} · {aiSettings.model} · chave terminada em <strong>••••{aiSettings.last4}</strong></span>
        </div>
      )}

      <div className="settings-ai-notice" role="note">
        <AlertTriangle aria-hidden="true" />
        <div>
          <p><strong>Seus dados financeiros são enviados ao provedor escolhido.</strong> Mensagens do assistente, imagens e PDFs enviados para análise podem conter descrições, valores e categorias. Consulte os termos e a política de privacidade do provedor. A chave é criptografada no servidor e nunca volta a ser exibida.</p>
          <label className="settings-ai-consent">
            <input type="checkbox" checked={aiConsent} onChange={handleAiConsentChange} disabled={aiBusy} />
            Entendi e concordo em enviar esses dados ao provedor selecionado.
          </label>
        </div>
      </div>
      {aiMessage && (
        <p className={`settings-ai-message is-${aiMessage.type}`} role={aiMessage.type === 'error' ? 'alert' : 'status'}>
          {aiMessage.text}
        </p>
      )}
    </Card>
  );
  const vehicleReminderForm = (
    <Card className="settings-card">
      <header className="settings-card-head">
        <div className="settings-icon"><Bell aria-hidden="true" /></div>
        <div className="settings-card-copy">
          <h2>Antecedência dos lembretes</h2>
          <p>Defina quando um lembrete de veículo muda para “Em breve”.</p>
        </div>
      </header>
      <form id="settings-vehicle-reminder-form" onSubmit={saveVehicleReminderSettings}>
        <div className="form-grid">
          <Field label="Avisar até (dias antes)">{(id) => <input id={id} className="input" type="number" min="0" max="365" value={vehicleReminderSettings.daysBefore} disabled={vehicleReminderSettingsLoading || vehicleReminderSettingsBusy} onChange={(event) => setVehicleReminderSettings((current) => ({ ...current, daysBefore: event.target.value }))} />}</Field>
          <Field label="Avisar até (km antes)">{(id) => <input id={id} className="input" type="number" min="0" max="100000" value={vehicleReminderSettings.kmBefore} disabled={vehicleReminderSettingsLoading || vehicleReminderSettingsBusy} onChange={(event) => setVehicleReminderSettings((current) => ({ ...current, kmBefore: event.target.value }))} />}</Field>
        </div>
      </form>
    </Card>
  );

  return (
    <div className={`settings-page${standaloneImport ? ' settings-import-standalone' : ''}`}>
      <PageHeader
        title={standaloneImport ? 'Importação' : 'Configurações'}
        subtitle={standaloneImport
          ? 'Importe planilhas e faturas, confira os dados e confirme antes de gravar.'
          : 'Gerencie categorias, importações, inteligência artificial, notificações e dados da sua conta.'}
      />

      <div className={`settings-layout${standaloneImport ? ' settings-import-layout' : ''}`}>
        {!standaloneImport && (
          <div className="settings-overview">
            <section className="settings-group">
              <h2>Dados</h2>
              <div className="settings-group-card">
                <button
                  id="settings-tab-categories"
                  type="button"
                  className="settings-option-row"
                  aria-haspopup="dialog"
                  aria-expanded={categoryManagerOpen}
                  onClick={() => setCategoryManagerOpen(true)}
                >
                  <span className="settings-option-icon"><Tag aria-hidden="true" /></span>
                  <span className="settings-option-copy">
                    <strong>Categorias</strong>
                    <small>Lançamentos e filtros</small>
                  </span>
                  <span className="settings-option-value">
                    {categoriesLoading ? 'Carregando…' : `${categories.length} cadastradas`}
                  </span>
                  <ChevronRight className="settings-option-chevron" aria-hidden="true" />
                </button>
                <button
                  id="settings-tab-import"
                  type="button"
                  className="settings-option-row"
                  aria-haspopup="dialog"
                  aria-expanded={activeSection === 'import'}
                  onClick={() => setActiveSection('import')}
                >
                  <span className="settings-option-icon"><FileSpreadsheet aria-hidden="true" /></span>
                  <span className="settings-option-copy">
                    <strong>Importação</strong>
                    <small>Planilha ou fatura em PDF</small>
                  </span>
                  <ChevronRight className="settings-option-chevron" aria-hidden="true" />
                </button>
              </div>
            </section>

            <section className="settings-group">
              <h2>Inteligência artificial</h2>
              <div className="settings-group-card">
                <button
                  id="settings-tab-ai"
                  type="button"
                  className="settings-option-row"
                  aria-haspopup="dialog"
                  aria-expanded={activeSection === 'ai'}
                  onClick={() => setActiveSection('ai')}
                >
                  <span className="settings-option-icon"><Sparkles aria-hidden="true" /></span>
                  <span className="settings-option-copy">
                    <strong>Chave de IA</strong>
                    <small>Gemini, OpenAI ou Claude</small>
                  </span>
                  <span className="settings-option-value">
                    {aiLoading ? 'Carregando' : aiEnabled ? 'Ativa' : aiSettings?.configured ? 'Consentimento pendente' : 'Sem chave'}
                  </span>
                  <ChevronRight className="settings-option-chevron" aria-hidden="true" />
                </button>
              </div>
            </section>

            <section className="settings-group">
              <h2>Lembretes</h2>
              <div className="settings-group-card">
                <button
                  id="settings-tab-vehicle-reminders"
                  type="button"
                  className="settings-option-row"
                  aria-haspopup="dialog"
                  aria-expanded={activeSection === 'vehicle-reminders'}
                  onClick={() => setActiveSection('vehicle-reminders')}
                >
                  <span className="settings-option-icon"><Bell aria-hidden="true" /></span>
                  <span className="settings-option-copy">
                    <strong>Lembretes de veículos</strong>
                    <small>Quando avisar “Em breve”</small>
                  </span>
                  <span className="settings-option-value">
                    {vehicleReminderSettingsLoading
                      ? 'Carregando'
                      : `${vehicleReminderSettings.daysBefore} dias · ${vehicleReminderSettings.kmBefore} km`}
                  </span>
                  <ChevronRight className="settings-option-chevron" aria-hidden="true" />
                </button>
                <button
                  id="settings-tab-push"
                  type="button"
                  className="settings-option-row"
                  aria-haspopup="dialog"
                  aria-expanded={activeSection === 'push'}
                  onClick={() => setActiveSection('push')}
                >
                  <span className="settings-option-icon"><Smartphone aria-hidden="true" /></span>
                  <span className="settings-option-copy">
                    <strong>Notificações no celular</strong>
                    <small>Faturas que vencem hoje ou estão atrasadas</small>
                  </span>
                  <ChevronRight className="settings-option-chevron" aria-hidden="true" />
                </button>
              </div>
            </section>

            <section className="settings-group">
              <h2>Sistema</h2>
              <div className="settings-group-card">
                <button
                  id="settings-tab-about"
                  type="button"
                  className="settings-option-row"
                  aria-haspopup="dialog"
                  aria-expanded={activeSection === 'about'}
                  onClick={() => setActiveSection('about')}
                >
                  <span className="settings-option-icon"><BadgeInfo aria-hidden="true" /></span>
                  <span className="settings-option-copy">
                    <strong>Sobre o sistema</strong>
                    <small>Autoria, versão e tecnologias</small>
                  </span>
                  <ChevronRight className="settings-option-chevron" aria-hidden="true" />
                </button>
              </div>
            </section>

            <section className="settings-group">
              <h2>Conta</h2>
              <div className="settings-group-card">
                <button
                  id="settings-tab-danger"
                  type="button"
                  className="settings-option-row is-danger"
                  aria-haspopup="dialog"
                  onClick={() => { setResetPhrase(''); setConfirmation({ kind: 'all' }); }}
                >
                  <span className="settings-option-icon"><Trash2 aria-hidden="true" /></span>
                  <span className="settings-option-copy">
                    <strong>Apagar dados da conta</strong>
                    <small>Não dá para desfazer</small>
                  </span>
                  <ChevronRight className="settings-option-chevron" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="settings-option-row is-danger"
                  onClick={() => setConfirmation({ kind: 'purchases' })}
                >
                  <span className="settings-option-icon"><Trash2 aria-hidden="true" /></span>
                  <span className="settings-option-copy">
                    <strong>Limpar lançamentos</strong>
                    <small>Apaga compras e parcelas, mantendo pessoas e cartões</small>
                  </span>
                  <ChevronRight className="settings-option-chevron" aria-hidden="true" />
                </button>
              </div>
            </section>
          </div>
        )}
        <SettingsPanels
          standaloneImport={standaloneImport}
          open={['import', 'ai', 'vehicle-reminders', 'push', 'about'].includes(activeSection)}
          title={activeSection === 'import'
            ? 'Importador de planilhas e faturas'
            : activeSection === 'ai'
              ? 'Chave de IA'
              : activeSection === 'vehicle-reminders'
                ? 'Lembretes de veículos'
                : activeSection === 'about'
                  ? 'Sobre o sistema'
                  : 'Notificações no celular'}
          onClose={closeSettingsModal}
          footer={(
            activeSection === 'ai'
              ? (
                <>
                  <Button onClick={closeSettingsModal}>Cancelar</Button>
                  <Button variant="primary" onClick={saveAiKey} disabled={aiLoading || aiBusy}>
                    {aiBusy ? 'Salvando…' : 'Salvar chave'}
                  </Button>
                </>
              )
              : activeSection === 'vehicle-reminders'
                ? (
                <>
                  <Button onClick={closeSettingsModal}>Cancelar</Button>
                  <Button type="submit" form="settings-vehicle-reminder-form" variant="primary" disabled={vehicleReminderSettingsLoading || vehicleReminderSettingsBusy}>
                    {vehicleReminderSettingsBusy ? 'Salvando…' : 'Salvar preferências'}
                  </Button>
                </>
                )
                : <Button onClick={closeSettingsModal}>{activeSection === 'push' ? 'Fechar' : 'Cancelar'}</Button>
          )}
        >
      <section
        id="settings-categories"
        className="settings-section"
        role="tabpanel"
        aria-labelledby="settings-tab-categories"
        tabIndex="0"
        hidden={activeSection !== 'categories'}
      >
      <Card className="settings-card">
        <header className="settings-card-head">
          <div className="settings-icon"><Tag aria-hidden="true" /></div>
          <div className="settings-card-copy">
            <h2>Categorias</h2>
            <p>Gerencie as categorias usadas nos lançamentos e filtros.</p>
          </div>
          {!categoriesLoading && <span className="settings-category-count">{categories.length} cadastradas</span>}
          <div className="settings-category-actions">
            <Button onClick={() => categoryPdfInput.current?.click()}>
              <Upload aria-hidden="true" /> Importar do PDF
            </Button>
            <Button variant="primary" onClick={() => setCategoryManagerOpen(true)}>
              <Tag aria-hidden="true" /> Gerenciar
            </Button>
          </div>
          <input
            ref={categoryPdfInput}
            className="settings-category-pdf-input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleCategoryPdfSelected}
            tabIndex="-1"
            aria-hidden="true"
          />
        </header>
      </Card>
      </section>

      <section
        id="settings-import"
        className="settings-section"
        role={standaloneImport ? 'region' : 'tabpanel'}
        aria-label={standaloneImport ? 'Importação' : undefined}
        aria-labelledby={standaloneImport ? undefined : 'settings-tab-import'}
        tabIndex={standaloneImport ? undefined : '0'}
        hidden={activeSection !== 'import'}
      >
        {importForm}
      </section>

      <section
        id="settings-ai"
        className="settings-section"
        role="tabpanel"
        aria-labelledby="settings-tab-ai"
        tabIndex="0"
        hidden={activeSection !== 'ai'}
      >
        {aiForm}
      </section>

      <section
        id="settings-vehicle-reminders"
        className="settings-section"
        role="tabpanel"
        aria-labelledby="settings-tab-vehicle-reminders"
        tabIndex="0"
        hidden={activeSection !== 'vehicle-reminders'}
      >
        {vehicleReminderForm}
      </section>

      <section
        id="settings-push"
        className="settings-section"
        role="tabpanel"
        aria-labelledby="settings-tab-push"
        tabIndex="0"
        hidden={activeSection !== 'push'}
      >
        <PushNotificationsSettings />
      </section>

      <section
        id="settings-about"
        className="settings-section"
        role="tabpanel"
        aria-labelledby="settings-tab-about"
        tabIndex="0"
        hidden={activeSection !== 'about'}
      >
        <Card className="settings-card settings-about-card">
          <header className="settings-card-head">
            <div className="settings-icon"><BadgeInfo aria-hidden="true" /></div>
            <div className="settings-card-copy">
              <h2>Caderno de Contas</h2>
              <p>Uma criação de Bianca Moura. Concebido, desenvolvido e mantido por sua criadora.</p>
            </div>
          </header>
          <dl className="settings-about-details">
            <div><dt>Desenvolvido por</dt><dd>Bianca Moura</dd></div>
            <div><dt>Versão atual</dt><dd>{version}</dd></div>
            <div><dt>Ano de criação</dt><dd>2026</dd></div>
            <div className="settings-about-wide">
              <dt>Propósito</dt>
              <dd>Organizar as finanças do dia a dia, acompanhar compras e parcelas, controlar contas a receber e manter os dados financeiros de cada usuário separados.</dd>
            </div>
            <div className="settings-about-wide">
              <dt>Tecnologias</dt>
              <dd>React 18, React Router 7, Vite 6, CSS, Lucide, Recharts, Node.js, Express 4, Mongoose, Zod e MongoDB.</dd>
            </div>
            <div className="settings-about-wide">
              <dt>Direitos autorais</dt>
              <dd>© 2026 Bianca Moura. Todos os direitos reservados. Reprodução, distribuição ou comercialização não autorizadas.</dd>
            </div>
          </dl>
        </Card>
      </section>

      <section
        id="settings-danger"
        className="settings-section"
        role="tabpanel"
        aria-labelledby="settings-tab-danger"
        tabIndex="0"
        hidden={activeSection !== 'danger'}
      >
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
      </section>
        </SettingsPanels>
      </div>

      <Modal
        open={removeAiConfirmation}
        title="Remover chave de IA"
        onClose={() => setRemoveAiConfirmation(false)}
        footer={(
          <>
            <Button onClick={() => setRemoveAiConfirmation(false)}>Cancelar</Button>
            <Button variant="primary" className="settings-button-danger" onClick={removeAiKey} disabled={aiBusy}>
              <Trash2 aria-hidden="true" /> Remover chave
            </Button>
          </>
        )}
      >
        <p>O assistente e a análise de PDFs ficarão indisponíveis até que uma nova chave seja configurada.</p>
      </Modal>

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
        open={Boolean(categoryPdfPreview)}
        title="Importar categorias do PDF"
        className="settings-category-import-modal"
        onClose={() => setCategoryPdfPreview(null)}
        dismissible
        footer={(
          <>
            <Button onClick={() => setCategoryPdfPreview(null)}>Cancelar</Button>
            {categoryPdfPreview?.newCategories?.length > 0 && (
              <Button variant="primary" onClick={handleConfirmCategoryPdfImport}>
                Importar {categoryPdfPreview.newCategories.length} {categoryPdfPreview.newCategories.length === 1 ? 'categoria' : 'categorias'}
              </Button>
            )}
          </>
        )}
      >
        {categoryPdfPreview && (
          <div className="settings-category-import-preview">
            <p className="muted">Confira as categorias identificadas pela IA. Somente as que ainda não existem serão adicionadas; nada será salvo sem sua confirmação.</p>
            <section>
              <h3>Novas categorias ({categoryPdfPreview.newCategories.length})</h3>
              {categoryPdfPreview.newCategories.length
                ? <ul>{categoryPdfPreview.newCategories.map((name) => <li key={name}>{name}</li>)}</ul>
                : <p className="muted">Nenhuma categoria nova foi encontrada.</p>}
            </section>
            {categoryPdfPreview.alreadyExists.length > 0 && (
              <section>
                <h3>Já cadastradas — não serão duplicadas ({categoryPdfPreview.alreadyExists.length})</h3>
                <ul>{categoryPdfPreview.alreadyExists.map((name) => <li key={name}>{name}</li>)}</ul>
              </section>
            )}
          </div>
        )}
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
            >
              {previewData?.sourceType === 'pdf' && (previewData.pdfRiskWarnings?.length ?? 0) > 0
                ? 'Confirmar e importar mesmo assim'
                : 'Confirmar e importar'} <ArrowRight aria-hidden="true" />
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
                ? 'Confira as compras reconhecidas e os vínculos com seus cadastros. O PDF é enviado ao provedor de IA configurado; nenhum dado será gravado até confirmar.'
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
                {previewData.pdfRiskWarnings?.length > 0 && (
                  <section className="settings-pdf-issues" role="alert" style={{ borderColor: '#f59e0b', background: '#fff7ed' }}>
                    <h3><AlertTriangle aria-hidden="true" /> 🚨 ATENÇÃO: Compras recentes com possível divergência de parcelas a vencer</h3>
                    <ul>{previewData.pdfRiskWarnings.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>
                  </section>
                )}
                {previewData.pdfIssues.length > 0 && (
                  <section className="settings-pdf-issues" role="alert">
                    <h3><AlertTriangle aria-hidden="true" /> Itens que precisam de atenção</h3>
                    <p>Observações de consistência podem aparecer em compras parceladas; elas são avisos informativos e não bloqueiam a importação.</p>
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
