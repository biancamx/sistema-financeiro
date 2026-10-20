import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  Calendar, 
  Clock, 
  Save, 
  Check, 
  MessageSquare,
  RotateCcw,
  AlertTriangle,
  Trash2
} from 'lucide-react';

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

    const formData = new FormData();
    formData.append('file', file);

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
        `🔢 Parcelas organizadas: ${json.data.installmentsCreated}`
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
    <div className="w-full space-y-6">
      {/* Título da Página */}
      <div>
        <h1 className="text-2xl font-bold text-[#e6f4f1]">Configurações</h1>
        <p className="text-sm text-[#7aa7a1] mt-1">Gerencie preferências, importação de planilhas e limpeza de dados.</p>
      </div>

      {/* 1. CARD DE IMPORTAÇÃO */}
      <div className="bg-[#0b1517] border border-[#132729] rounded-xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#132729]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#0e3532] text-[#2dd4bf] flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#e6f4f1]">Importação de Gastos (Banco De Dados)</h2>
              <p className="text-xs text-[#7aa7a1]">
                Lê a aba <strong>Banco De Dados</strong> da sua planilha e organiza as compras por pessoa e cartão.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleUndoImport}
            disabled={reverting || importing}
            className="px-3.5 py-2 text-xs font-medium text-[#7aa7a1] hover:text-[#e6f4f1] bg-[#102224] hover:bg-[#163033] rounded-lg transition disabled:opacity-40"
          >
            {reverting ? 'Revertendo...' : 'Desfazer Lançamentos'}
          </button>
        </div>

        {/* Área de Upload */}
        <div className="border border-dashed border-[#1a383a] rounded-xl p-8 text-center bg-[#070e10]/60">
          <Upload className="w-9 h-9 text-[#4d7874] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#e6f4f1]">
            {importing ? 'Processando planilha... Aguarde...' : 'Selecione a sua planilha Financeiro_2026.xlsx ou Financeiro_2027.xlsx'}
          </p>
          <p className="text-xs text-[#7aa7a1] mt-1">
            Reconhece: Descrição, Pessoa, Valor da Parcela, Mês, Ano e Cartão.
          </p>

          <label className="mt-4 inline-block">
            <span className="px-4 py-2 bg-[#1db59b] hover:bg-[#179680] text-[#041d1a] font-bold text-xs rounded-lg cursor-pointer transition shadow-sm inline-flex items-center gap-2">
              <Upload className="w-4 h-4" /> Escolher arquivo da planilha
            </span>
            <input
              type="file"
              disabled={importing}
              accept=".xlsx, .xls, .csv"
              onChange={handleFileImport}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* 2. CARD DO AGENDAMENTO DE LEMBRETES */}
      <div className="bg-[#0b1517] border border-[#132729] rounded-xl p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-[#132729]">
          <div className="w-10 h-10 rounded-lg bg-[#0e3532] text-[#2dd4bf] flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#e6f4f1]">Disparo Automático de Lembretes</h2>
            <p className="text-xs text-[#7aa7a1]">Escolha o dia e horário em que os lembretes de fatura serão calculados.</p>
          </div>
        </div>

        {loadingSettings ? (
          <div className="py-6 text-center text-xs text-[#7aa7a1]">Carregando preferências...</div>
        ) : (
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="enableReminders"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-[#1db59b] bg-[#070e10] border-[#1a383a] focus:ring-0"
              />
              <label htmlFor="enableReminders" className="text-sm text-[#e6f4f1] cursor-pointer">
                Ativar envio automático mensal de cobranças
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-[#7aa7a1] mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-[#2dd4bf]" />
                  Dia do Mês para o Disparo
                </label>
                <select
                  disabled={!enabled}
                  value={triggerDay}
                  onChange={(e) => setTriggerDay(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#070e10] border border-[#1a383a] rounded-lg text-sm text-[#e6f4f1] focus:outline-none focus:border-[#2dd4bf] disabled:opacity-40"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Todo dia {String(d).padStart(2, '0')} do mês
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#7aa7a1] mb-1.5 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-[#2dd4bf]" />
                  Horário do Envio
                </label>
                <select
                  disabled={!enabled}
                  value={triggerHour}
                  onChange={(e) => setTriggerHour(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#070e10] border border-[#1a383a] rounded-lg text-sm text-[#e6f4f1] focus:outline-none focus:border-[#2dd4bf] disabled:opacity-40"
                >
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00h
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-[#132729] flex items-center justify-between">
              {savedSuccess && (
                <span className="text-xs text-[#2dd4bf] font-medium flex items-center gap-1">
                  <Check className="w-4 h-4" /> Preferências salvas!
                </span>
              )}
              <button
                type="submit"
                disabled={saving}
                className="ml-auto px-4 py-2 bg-[#1db59b] hover:bg-[#179680] text-[#041d1a] font-bold text-xs rounded-lg transition disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar Preferências'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* 3. ZONA DE PERIGO (RESET DE DADOS) */}
      <div className="bg-[#0b1517] border border-[#2b1819] rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-[#1f1617]">
          <div className="w-10 h-10 rounded-lg bg-[#2d1214] text-[#f87171] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#fca5a5]">Zona de Perigo • Limpeza Geral</h2>
            <p className="text-xs text-[#7aa7a1]">
              Utilize para recomeçar seus lançamentos ou limpar o banco antes de importar uma nova planilha.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Card 1: Limpar só Compras */}
          <div className="bg-[#070e10] border border-[#1a383a] rounded-lg p-4 flex flex-col justify-between">
            <div>
              <div className="text-sm font-medium text-[#e6f4f1]">Excluir Todos os Lançamentos</div>
              <p className="text-xs text-[#7aa7a1] mt-1 leading-relaxed">
                Apaga todas as compras e parcelas de cartões, mas mantém seus cartões e pessoas cadastrados.
              </p>
            </div>
            <div className="pt-4">
              <button
                type="button"
                disabled={resetting}
                onClick={() => executeReset('purchases_only')}
                className="w-full py-2 px-3 bg-[#172622] hover:bg-[#203631] text-[#f59e0b] text-xs font-semibold rounded-lg transition"
              >
                {resetting ? 'Limpando...' : 'Limpar Apenas Lançamentos'}
              </button>
            </div>
          </div>

          {/* Card 2: Reset Completo */}
          <div className="bg-[#070e10] border border-[#2b1819] rounded-lg p-4 flex flex-col justify-between">
            <div>
              <div className="text-sm font-medium text-[#fca5a5]">Reset Total da Conta</div>
              <p className="text-xs text-[#7aa7a1] mt-1 leading-relaxed">
                Zera tudo: apaga todas as compras, cartões de crédito, pessoas e planilhas da sua conta.
              </p>
            </div>
            <div className="pt-4">
              <button
                type="button"
                disabled={resetting}
                onClick={() => executeReset('all')}
                className="w-full py-2 px-3 bg-[#3f1518] hover:bg-[#521c20] text-[#fca5a5] text-xs font-semibold rounded-lg transition"
              >
                {resetting ? 'Resetando...' : 'Resetar Tudo (Conta Limpa)'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}