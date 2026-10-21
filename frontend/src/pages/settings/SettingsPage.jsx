import { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button, Card, Modal, PageHeader } from '../../components/ui/ui.jsx';
import { useAppBusy } from '../../context/BusyContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { importApi, systemApi } from '../../services/api.js';
import './SettingsPage.css';

const IMPORT_COUNT_CARDS = [
  ['Pessoas', (data) => data.people.length],
  ['Cartões', (data) => data.cards.length],
  ['Compras agrupadas', (data) => data.summaryCounts.purchasesCount],
  ['Parcelas no período', (data) => data.summaryCounts.installmentsCount],
  ['Linhas da planilha', (data) => data.summaryCounts.budgetLinesCount],
];

export default function SettingsPage() {
  const [previewData, setPreviewData] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [resetPhrase, setResetPhrase] = useState('');
  const fileInput = useRef(null);
  const { begin, end } = useAppBusy();
  const toast = useToast();

  async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    begin('Analisando sua planilha');

    try {
      const result = await importApi.previewSpreadsheet(formData);
      if (!result?.data?.people || !result?.data?.cards || !result?.data?.summaryCounts) {
        throw new Error('A API retornou uma prévia incompleta para esta planilha.');
      }
      setPreviewData(result.data);
    } catch (error) {
      toast.error(error);
    } finally {
      end();
      event.target.value = '';
    }
  }

  async function handleConfirmImport() {
    if (!previewData) return;
    const analyzedData = previewData;
    setPreviewData(null);
    begin('Importando os dados da planilha');
    try {
      const result = await importApi.executeSpreadsheet(analyzedData);
      const summary = result?.summary;
      if (!summary) throw new Error('A API não confirmou a importação.');
      setPreviewData(null);
      toast.success(
        `Importação concluída: ${summary.peopleUpserted} pessoas, ${summary.cardsUpserted} cartões, ${summary.purchasesUpserted} compras, ${summary.installmentsUpserted} parcelas e ${summary.budgetsUpserted} linhas.`,
      );
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
          <div className="settings-icon"><FileSpreadsheet aria-hidden="true" /></div>
          <div className="settings-card-copy">
            <h2>Importador de planilhas</h2>
            <p>Envie sua planilha financeira para conferir os dados antes de gravar.</p>
          </div>
        </header>

        <div className="settings-upload">
          <Upload className="settings-upload-icon" aria-hidden="true" />
          <h3>Selecione uma planilha financeira</h3>
          <p>Compatível com arquivos .xlsx e .xls. A prévia permite conferir totais e divergências antes da importação.</p>
          <Button
            variant="primary"
            className="settings-file-button"
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden="true" />
            Selecionar planilha
          </Button>
          <input
            ref={fileInput}
            type="file"
            disabled={false}
            accept=".xlsx,.xls"
            onChange={handleFileSelected}
            className="settings-file-input"
            aria-label="Selecionar arquivo de planilha"
          />
          <span className="settings-upload-hint">Os demais menus ficam bloqueados enquanto o arquivo é analisado ou salvo.</span>
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
        open={Boolean(previewData)}
        title="Conferir importação"
        wide
        onClose={() => setPreviewData(null)}
        footer={(
          <>
            <Button onClick={() => setPreviewData(null)}><X aria-hidden="true" /> Cancelar</Button>
            <Button variant="primary" onClick={handleConfirmImport}>
              Confirmar e importar <ArrowRight aria-hidden="true" />
            </Button>
          </>
        )}
      >
        {previewData && (
          <div className="settings-preview">
            <p className="muted">Revise os dados detectados. A gravação atualiza registros existentes sem duplicá-los.</p>
            <div className="settings-count-grid">
              {IMPORT_COUNT_CARDS.map(([label, count]) => (
                <div className="settings-count" key={label}>
                  <span>{label}</span>
                  <strong>{count(previewData)}</strong>
                </div>
              ))}
            </div>
            <section className="settings-check">
              <h3><ShieldCheck aria-hidden="true" /> Conferência dos totais</h3>
              {previewData.divergences.length === 0 ? (
                <p className="settings-check-ok"><CheckCircle2 aria-hidden="true" /> Os totais das abas mensais conferem.</p>
              ) : (
                <ul className="settings-divergences">
                  {previewData.divergences.map((divergence, index) => (
                    <li key={`${divergence.section}-${index}`}>
                      <strong>{divergence.section}</strong>
                      <span>Planilha: {divergence.sheetTotal} · Calculado: {divergence.calculatedTotal}</span>
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
        onClose={() => { setConfirmation(null); setResetPhrase(''); }}
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
