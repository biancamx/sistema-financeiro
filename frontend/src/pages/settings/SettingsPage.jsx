import React, { useState, useEffect } from 'react';
import { AlertTriangle, Calendar, Check, Clock, FileSpreadsheet, MessageSquare, RotateCcw, Upload } from 'lucide-react';
import './SettingsPage.css';

export default function SettingsPage() {
  const [triggerDay, setTriggerDay] = useState(5);
  const [triggerHour, setTriggerHour] = useState(9);
  const [enabled, setEnabled] = useState(true);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [importing, setImporting] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoadingSettings(true);
      const res = await fetch('/api/reminders/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTriggerDay(data.trigger_day || 5);
        setTriggerHour(data.trigger_hour || 9);
        setEnabled(data.enabled === 1);
      }
    } catch (err) {
      console.error('Falha ao carregar configurações:', err);
    } finally {
      setLoadingSettings(false);
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const res = await fetch('/api/reminders/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ trigger_day: triggerDay, trigger_hour: triggerHour, enabled }),
      });
      if (!res.ok) throw new Error('Falha ao salvar preferências');
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      alert(err.message || 'Erro ao salvar preferências de agendamento.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFileImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm(
      'A importação vai substituir todos os lançamentos e parcelas atuais da sua conta pelos dados da planilha. Cartões e pessoas serão mantidos. Deseja continuar?',
    )) {
      e.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('replaceExisting', 'true');

    try {
      setImporting(true);
      const res = await fetch('/api/import/spreadsheet', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro na importação');

      alert(
        `🎉 Importação Concluída com Sucesso!\n\n` +
        `👥 Pessoas identificadas/criadas: ${json.data.peopleCreated}\n` +
        `💳 Cartões identificados/criados: ${json.data.cardsCreated}\n` +
        `🛍️ Compras registradas: ${json.data.purchasesCreated}\n` +
        `🔢 Parcelas organizadas: ${json.data.installmentsCreated}\n` +
        `🧹 Compras anteriores substituídas: ${json.data.purchasesReplaced}` +
        (json.data.installmentAmountsCalculated
          ? `\n🧮 Valores de parcelas calculados pelo total da compra: ${json.data.installmentAmountsCalculated}`
          : '')
      );
      window.location.reload();
    } catch (err) {
      alert(`Erro ao importar: ${err.message}`);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  async function handleUndoImport() {
    if (!window.confirm('Deseja desfazer a última importação de lançamentos?')) {
      return;
    }

    try {
      setReverting(true);
      const res = await fetch('/api/import/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      alert(json.message);
      window.location.reload();
    } catch (err) {
      alert(`Erro ao reverter: ${err.message}`);
    } finally {
      setReverting(false);
    }
  }

  async function executeReset(targetType) {
    if (targetType === 'all') {
      const conf1 = window.confirm('ATENÇÃO: Deseja apagar TODOS os lançamentos, cartões e pessoas da sua conta?');
      if (!conf1) return;
      const conf2 = prompt('Digite "RESETAR" em maiúsculo para confirmar:');
      if (conf2 !== 'RESETAR') {
        alert('Ação cancelada. Nenhum dado foi alterado.');
        return;
      }
    } else {
      if (!window.confirm('Tem certeza que deseja apagar TODOS os lançamentos e compras? (Pessoas e cartões serão mantidos)')) {
        return;
      }
    }

    try {
      setResetting(true);
      const res = await fetch('/api/import/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ target: targetType }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro na requisição');

      alert(json.message || 'Limpeza realizada com sucesso!');
      window.location.reload();
    } catch (err) {
      alert(`Falha ao executar limpeza: ${err.message}`);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="page-head settings-page-head">
        <div>
          <h1>Configurações</h1>
          <p className="muted">Gerencie preferências, importação de planilhas e limpeza de dados.</p>
        </div>
      </header>

      <section className="card settings-card" aria-labelledby="settings-import-title">
        <div className="settings-card-head">
          <div className="settings-icon"><FileSpreadsheet aria-hidden="true" /></div>
          <div className="settings-card-copy">
            <h2 id="settings-import-title">Importação de gastos</h2>
            <p className="muted">Lê a aba <strong>Banco De Dados</strong> da sua planilha e organiza as compras por pessoa e cartão.</p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={handleUndoImport}
            disabled={reverting || importing}
          >
            <RotateCcw aria-hidden="true" />
            {reverting ? 'Revertendo...' : 'Desfazer lançamentos'}
          </button>
        </div>

        <div className="settings-upload">
          <Upload className="settings-upload-icon" aria-hidden="true" />
          <h3>{importing ? 'Processando planilha...' : 'Importe sua planilha financeira'}</h3>
          <p className="muted">Selecione Financeiro_2026.xlsx ou Financeiro_2027.xlsx. Também aceitamos .xls e .csv.</p>
          <p className="settings-upload-hint">Reconhece descrição, pessoa, valor da parcela, mês, ano e cartão.</p>
          <label className="btn btn-primary settings-file-button">
            <Upload aria-hidden="true" />
            Escolher arquivo
            <input
              type="file"
              disabled={importing}
              accept=".xlsx, .xls, .csv"
              onChange={handleFileImport}
            />
          </label>
        </div>
      </section>

      <section className="card settings-card" aria-labelledby="settings-reminders-title">
        <div className="settings-card-head">
          <div className="settings-icon"><MessageSquare aria-hidden="true" /></div>
          <div className="settings-card-copy">
            <h2 id="settings-reminders-title">Disparo automático de lembretes</h2>
            <p className="muted">Escolha o dia e horário em que os lembretes de fatura serão calculados.</p>
          </div>
        </div>

        {loadingSettings ? (
          <div className="settings-loading" role="status">Carregando preferências...</div>
        ) : (
          <form onSubmit={handleSaveSettings} className="settings-reminder-form">
            <label className="share-toggle settings-reminder-toggle">
              <input
                type="checkbox"
                id="enableReminders"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>
                Ativar envio automático mensal de cobranças
                <small className="muted">Você pode alterar essa opção a qualquer momento.</small>
              </span>
            </label>

            <div className="settings-fields">
              <label className="field" htmlFor="triggerDay">
                <span className="field-label"><Calendar aria-hidden="true" /> Dia do mês para o disparo</span>
                <select
                  id="triggerDay"
                  className="input"
                  disabled={!enabled}
                  value={triggerDay}
                  onChange={(e) => setTriggerDay(Number(e.target.value))}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>Todo dia {String(d).padStart(2, '0')} do mês</option>
                  ))}
                </select>
              </label>

              <label className="field" htmlFor="triggerHour">
                <span className="field-label"><Clock aria-hidden="true" /> Horário do envio</span>
                <select
                  id="triggerHour"
                  className="input"
                  disabled={!enabled}
                  value={triggerHour}
                  onChange={(e) => setTriggerHour(Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="settings-form-actions">
              {savedSuccess && (
                <span className="settings-saved" role="status"><Check aria-hidden="true" /> Preferências salvas!</span>
              )}
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar preferências'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card settings-card settings-danger" aria-labelledby="settings-danger-title">
        <div className="settings-card-head">
          <div className="settings-icon settings-icon-danger"><AlertTriangle aria-hidden="true" /></div>
          <div className="settings-card-copy">
            <h2 id="settings-danger-title">Zona de perigo</h2>
            <p className="muted">Limpeza de dados da conta. Essa ação não pode ser desfeita.</p>
          </div>
        </div>

        <div className="settings-reset-grid">
          <article className="settings-reset-option">
            <div>
              <h3>Excluir todos os lançamentos</h3>
              <p className="muted">Apaga compras e parcelas, mas mantém seus cartões e pessoas cadastrados.</p>
            </div>
            <button
              type="button"
              className="btn settings-button-warning"
              disabled={resetting}
              onClick={() => executeReset('purchases_only')}
            >
              {resetting ? 'Limpando...' : 'Limpar apenas lançamentos'}
            </button>
          </article>

          <article className="settings-reset-option settings-reset-option-danger">
            <div>
              <h3>Reset total da conta</h3>
              <p className="muted">Apaga todos os lançamentos, cartões, pessoas e planilhas da sua conta.</p>
            </div>
            <button
              type="button"
              className="btn settings-button-danger"
              disabled={resetting}
              onClick={() => executeReset('all')}
            >
              {resetting ? 'Resetando...' : 'Resetar toda a conta'}
            </button>
          </article>
        </div>
      </section>
    </div>
  );
}