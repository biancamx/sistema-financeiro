import { useState } from 'react';
import { useToast } from '../../context/ToastContext.jsx';
import { toolsApi } from '../../services/api.js';
import { Button, Card, Field, Money, PageHeader, Select } from '../../components/ui/ui.jsx';
import { parseMoney } from '../../lib/format.js';

// Valores iniciais = exemplo da aba Dashboard da planilha
const initial = { salary: '4.500,00', admission: '2023-05-24', dismissal: '2026-09-04', reason: 'Sem justa causa', notice: 'Trabalhado', fgtsBalance: '5.000,00' };

export default function RescissionPage() {
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));

  const calc = async (e) => {
    e.preventDefault();
    const salary = parseMoney(f.salary);
    const fgtsBalance = parseMoney(f.fgtsBalance);
    if (!(salary > 0) || Number.isNaN(fgtsBalance)) return toast.error(new Error('Confira o salário e o saldo do FGTS'));
    setBusy(true);
    try { setResult(await toolsApi.rescission({ salary, fgtsBalance, admission: f.admission, dismissal: f.dismissal, reason: f.reason, notice: f.notice })); }
    catch (err) { toast.error(err); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Calculadora de rescisão" subtitle="Estimativa com as mesmas regras do bloco de rescisão da planilha" />
      <div className="grid-2">
        <Card title="Dados do contrato">
          <form className="form-grid" onSubmit={calc}>
            <Field label="Salário bruto (R$)">{(id) => <input id={id} className="input" inputMode="decimal" value={f.salary} onChange={set('salary')} />}</Field>
            <Field label="Saldo atual do FGTS (R$)">{(id) => <input id={id} className="input" inputMode="decimal" value={f.fgtsBalance} onChange={set('fgtsBalance')} />}</Field>
            <Field label="Data de admissão">{(id) => <input id={id} className="input" type="date" value={f.admission} onChange={set('admission')} />}</Field>
            <Field label="Data de demissão">{(id) => <input id={id} className="input" type="date" value={f.dismissal} onChange={set('dismissal')} />}</Field>
            <Field label="Motivo do desligamento">{(id) => <Select id={id} value={f.reason} onChange={set('reason')} options={['Sem justa causa', 'Justa causa', 'Pedido de demissão', 'Acordo'].map((v) => ({ value: v, label: v }))} />}</Field>
            <Field label="Aviso prévio">{(id) => <Select id={id} value={f.notice} onChange={set('notice')} options={['Trabalhado', 'Indenizado'].map((v) => ({ value: v, label: v }))} />}</Field>
            <div className="form-actions"><Button type="submit" variant="primary" disabled={busy}>Calcular</Button></div>
          </form>
        </Card>
        <Card title="Resultado da rescisão">
          {!result ? <p className="muted">Preencha os dados e calcule.</p> : (
            <>
              <p className="muted">{result.yearsWorked} anos e {result.monthsWorked % 12} meses de casa</p>
              <div className="table-responsive"><table className="table">
                <tbody>{result.items.map((i) => <tr key={i.key}><td>{i.label}</td><td className="num"><Money value={i.value} /></td></tr>)}</tbody>
                <tfoot><tr><td>Total das verbas rescisórias</td><td className="num"><Money value={result.total} strong /></td></tr></tfoot>
              </table></div>
              <div className="rescission-total">
                <div className="rescission-total-row">
                  <span>Saldo do FGTS</span>
                  <Money value={result.fgtsBalance} />
                </div>
                <div className="rescission-total-row rescission-total-grand">
                  <span>Estimativa total a receber</span>
                  <Money value={result.totalToReceive} strong />
                </div>
              </div>
              <p className="field-hint">O total soma as verbas rescisórias ao saldo do FGTS informado. A possibilidade de saque depende do motivo do desligamento e das regras aplicáveis. É uma estimativa; descontos (INSS, IRRF) e particularidades do contrato não estão incluídos.</p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
