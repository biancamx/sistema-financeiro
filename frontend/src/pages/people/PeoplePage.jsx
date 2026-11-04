import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Link2, MessageCircle } from 'lucide-react';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { remindersApi, peopleApi, systemApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Field, Modal, Money, PageHeader, Spinner } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';
import { MONTHS } from '../../lib/format.js';

function maskPhone(value) {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function birthDateInfo(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const birth = new Date(year, month - 1, day);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day)) age -= 1;
  return { formatted: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`, age };
}

async function processAvatarImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');
  const image = await createImageBitmap(file);
  try {
    const cropSize = Math.min(image.width, image.height);
    const sourceX = (image.width - cropSize) / 2;
    const sourceY = (image.height - cropSize) / 2;
    for (const size of [256, 192, 128, 96]) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Não foi possível processar a imagem.');
      context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);
      for (const quality of [0.82, 0.68, 0.54, 0.4]) {
        const data = canvas.toDataURL('image/jpeg', quality);
        if (data.length <= 20 * 1024) return data;
      }
    }
    throw new Error('A imagem não pôde ser reduzida o suficiente. Escolha outra foto.');
  } finally {
    image.close();
  }
}

function PersonAvatar({ person }) {
  const [imageUrl, setImageUrl] = useState(person.avatar || null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setImageFailed(false);
    setImageUrl(person.avatar || null);

    const email = person.email?.trim().toLowerCase();
    if (!person.avatar && email && globalThis.crypto?.subtle) {
      globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(email))
        .then((digest) => {
          if (!active) return;
          const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
          setImageUrl(`https://www.gravatar.com/avatar/${hash}?d=404&s=96`);
        })
        .catch((error) => {
          if (active) console.error('Não foi possível gerar o avatar do Gravatar:', error);
        });
    }

    return () => {
      active = false;
    };
  }, [person.avatar, person.email]);

  const initials = person.name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '?';

  return imageUrl && !imageFailed ? (
    <img
      className="person-avatar-image"
      src={imageUrl}
      alt={`Foto de ${person.name}`}
      onError={() => setImageFailed(true)}
    />
  ) : (
    <div className="person-avatar" aria-hidden="true">{initials}</div>
  );
}

const emptyForm = { name: '', phone: '', email: '', birthDate: '', pixKey: '', avatar: null, notes: '' };

export default function PeoplePage() {
  const { month, year } = usePeriod();
  const toast = useToast();
  const { data, error, reload } = useFetch(() => peopleApi.list(), []);
  const portalContact = useFetch(() => systemApi.getPortalContact(), []);
  const [editing, setEditing] = useState(null);
  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [billingPerson, setBillingPerson] = useState(null);
  const [billing, setBilling] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [settlingMonth, setSettlingMonth] = useState(false);
  const [billingError, setBillingError] = useState(false);
  const [modalMonth, setModalMonth] = useState(month || new Date().getMonth() + 1);
  const [modalYear, setModalYear] = useState(year || new Date().getFullYear());
  const [copied, setCopied] = useState(false);
  const fileInput = useRef(null);
  const billingRequest = useRef(0);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;

  const fetchBilling = async (personId, targetMonth, targetYear) => {
    const requestId = ++billingRequest.current;
    setBillingLoading(true);
    setBilling(null);
    setBillingError(false);
    setCopied(false);
    try {
      const summary = await remindersApi.getPersonBilling(personId, targetMonth, targetYear);
      if (requestId === billingRequest.current) setBilling(summary);
      return summary;
    } catch (e) {
      if (requestId === billingRequest.current) {
        setBillingError(true);
        toast.error(e);
      }
      return null;
    } finally {
      if (requestId === billingRequest.current) setBillingLoading(false);
    }
  };
  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setPersonModalOpen(true);
  };
  const openEdit = (person) => {
    setEditing(person);
    setForm({
      name: person.name || '',
      phone: maskPhone(person.phone || ''),
      email: person.email || '',
      birthDate: person.birth_date || '',
      pixKey: person.pix_key || '',
      avatar: person.avatar || null,
      notes: person.notes || '',
    });
    setPersonModalOpen(true);
  };
  const setFormValue = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const changeAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setFormValue('avatar', await processAvatarImage(file));
    } catch (e) {
      toast.error(e);
    } finally {
      event.target.value = '';
    }
  };
  const save = async () => {
    if (!form.name.trim()) return toast.error(new Error('O nome é obrigatório'));
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        birthDate: form.birthDate || null,
        pixKey: form.pixKey.trim() || null,
        avatar: form.avatar || null,
        notes: form.notes.trim() || null,
      };
      if (editing) await peopleApi.update(editing.id, payload);
      else await peopleApi.create(payload);
      toast.success(editing ? 'Pessoa atualizada' : 'Pessoa adicionada');
      setEditing(null);
      setPersonModalOpen(false);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (person) => {
    if (!window.confirm(`Excluir ${person.name}? Compras e planilhas dessa pessoa também serão apagadas.`)) return;
    try {
      await peopleApi.remove(person.id);
      toast.success('Pessoa excluída');
      reload();
    } catch (e) {
      toast.error(e);
    }
  };
  const openBilling = (person) => {
    const initialMonth = month || new Date().getMonth() + 1;
    const initialYear = year || new Date().getFullYear();
    setBillingPerson(person);
    setModalMonth(initialMonth);
    setModalYear(initialYear);
    fetchBilling(person.id, initialMonth, initialYear);
  };
  const changeBillingMonth = (event) => {
    const selectedMonth = Number(event.target.value);
    setModalMonth(selectedMonth);
    if (billingPerson) fetchBilling(billingPerson.id, selectedMonth, modalYear);
  };
  const changeBillingYear = (event) => {
    const selectedYear = Number(event.target.value);
    setModalYear(selectedYear);
    if (billingPerson) fetchBilling(billingPerson.id, modalMonth, selectedYear);
  };
  const closeBilling = () => {
    billingRequest.current += 1;
    setBillingPerson(null);
    setBilling(null);
    setBillingLoading(false);
    setBillingError(false);
  };

  const copyPortalLink = async (person) => {
    const portalUrl = `${window.location.origin}/portal/${person.share_token}`;
    try {
      await navigator.clipboard.writeText(portalUrl);
      toast.success(`Link do portal de ${person.name} copiado.`);
    } catch {
      toast.error(new Error('Não foi possível copiar o link. Verifique a permissão da área de transferência.'));
    }
  };
  const copyPixKey = async (person) => {
    try {
      await navigator.clipboard.writeText(person.pix_key);
      toast.success('Chave Pix copiada.');
    } catch {
      toast.error(new Error('Não foi possível copiar a chave Pix. Verifique a permissão da área de transferência.'));
    }
  };
  const togglePortalContact = async (person) => {
    if (!person.phone) {
      toast.error(new Error('Cadastre um telefone para essa pessoa antes de defini-la como contato do portal.'));
      return;
    }
    try {
      const selected = portalContact.data?.personId === person.id;
      const contact = await systemApi.setPortalContact(selected ? null : person.id);
      portalContact.setData(contact);
      toast.success(selected
        ? 'Contato do Portal do participante removido.'
        : `${person.name} receberá as mensagens do Portal do participante.`);
    } catch (e) {
      toast.error(e);
    }
  };
  const copyMessage = async () => {
    if (!billing?.formattedMessage) return;
    try {
      await navigator.clipboard.writeText(billing.formattedMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      toast.error(e);
    }
  };
  const settleMonth = async () => {
    if (!billingPerson || !billing) return;
    const monthName = MONTHS[modalMonth - 1];
    if (!window.confirm(`Deseja marcar como pagas todas as despesas de ${billingPerson.name} em ${monthName}/${modalYear}?`)) return;

    setSettlingMonth(true);
    try {
      const result = await remindersApi.settlePersonMonth(billingPerson.id, modalMonth, modalYear);
      const updatedBilling = await fetchBilling(billingPerson.id, modalMonth, modalYear);
      if (updatedBilling) {
        window.dispatchEvent(new Event('reminders:refresh'));
        toast.success(result.message || 'Despesas do mês quitadas');
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setSettlingMonth(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Pessoas"
        subtitle="Gerencie participantes, contatos, aniversários e demonstrativos de cobrança"
        actions={<Button variant="primary" onClick={openCreate}>Nova pessoa</Button>}
      />
      {data.length === 0 ? (
        <Card><EmptyState title="Ninguém cadastrado">Adicione pessoas para associar aos gastos e cobranças.</EmptyState></Card>
      ) : (
        <section className="person-grid" aria-label="Pessoas cadastradas">
          {data.map((person) => {
            const birthday = birthDateInfo(person.birth_date);
            return (
              <Card className="person-card" key={person.id}>
                <div className="person-card-identity">
                  <PersonAvatar person={person} />
                  <div className="person-card-name">
                    <h2>{person.name}</h2>
                    <span className="muted">{person.phone ? maskPhone(person.phone) : 'Sem telefone cadastrado'}</span>
                  </div>
                </div>
                <div className="person-profile-details">
                  {person.email && <span title={person.email}>E-mail: {person.email}</span>}
                  {birthday && <span>Aniversário: {birthday.formatted} ({birthday.age} anos)</span>}
                  {person.pix_key && (
                    <span className="person-pix-key" title={person.pix_key}>
                      <span>Pix: {person.pix_key}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Copiar chave Pix de ${person.name}`}
                        title="Copiar chave Pix"
                        onClick={() => copyPixKey(person)}
                      >
                        <Copy size={14} aria-hidden="true" />
                        Copiar
                      </Button>
                    </span>
                  )}
                  {person.notes && <span className="person-notes">{person.notes}</span>}
                </div>
                <p className="muted small">{person.purchases} compra(s) registrada(s)</p>
                <div className="person-card-actions">
                  <Button variant="primary" size="sm" onClick={() => openBilling(person)}>Cobrar no WhatsApp</Button>
                  <Button
                    variant={portalContact.data?.personId === person.id ? 'primary' : 'ghost'}
                    size="sm"
                    disabled={portalContact.loading || Boolean(portalContact.error) || !person.phone}
                    title={person.phone ? 'Usar este telefone para receber mensagens do Portal do participante' : 'Cadastre um telefone para habilitar'}
                    onClick={() => togglePortalContact(person)}
                  >
                    <MessageCircle size={14} aria-hidden="true" />
                    {portalContact.data?.personId === person.id ? 'Contato do portal' : 'Usar no portal'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => copyPortalLink(person)}>
                    <Link2 size={14} aria-hidden="true" /> Portal
                  </Button>
                  <Link className="btn btn-ghost btn-sm" to={`${PATHS.budget}/${person.id}/${new Date().getFullYear()}`}>Planilha</Link>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(person)}>Editar</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(person)}>Excluir</Button>
                </div>
              </Card>
            );
          })}
        </section>
      )}

      <Modal
        open={personModalOpen}
        title={editing ? 'Editar pessoa' : 'Nova pessoa'}
        wide
        footer={<><Button variant="ghost" onClick={() => { setPersonModalOpen(false); setEditing(null); setForm({ ...emptyForm }); }}>Cancelar</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar'}</Button></>}
      >
        <div className="person-avatar-editor">
          <button type="button" className="person-avatar-upload" onClick={() => fileInput.current?.click()} aria-label="Escolher foto de perfil">
            <PersonAvatar person={{ name: form.name || 'Pessoa', email: form.email, avatar: form.avatar }} />
          </button>
          <div>
            <strong>Foto de perfil</strong>
            <p className="muted small">Se houver uma foto pública no Gravatar associado ao e-mail, ela aparece aqui. Você também pode escolher uma foto do computador, que será cortada e reduzida para até 20 KB.</p>
            <div className="inline person-avatar-actions">
              <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>Escolher foto</Button>
              {form.avatar && <Button size="sm" variant="ghost" onClick={() => setFormValue('avatar', null)}>Remover</Button>}
            </div>
          </div>
          <input ref={fileInput} className="person-file-input" type="file" accept="image/*" onChange={changeAvatar} />
        </div>
        <div className="form-grid">
          <Field label="Nome completo *">{(id) => <input id={id} className="input" value={form.name} onChange={(e) => setFormValue('name', e.target.value)} autoFocus required maxLength={60} />}</Field>
          <Field label="WhatsApp / celular">{(id) => <input id={id} className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" value={form.phone} onChange={(e) => setFormValue('phone', maskPhone(e.target.value))} />}</Field>
          <Field label="E-mail">{(id) => <input id={id} className="input" type="email" autoComplete="email" maxLength={254} value={form.email} onChange={(e) => setFormValue('email', e.target.value)} />}</Field>
          <Field label="Data de nascimento">{(id) => <input id={id} className="input" type="date" value={form.birthDate} onChange={(e) => setFormValue('birthDate', e.target.value)} />}</Field>
          <Field label="Chave Pix">{(id) => <input id={id} className="input" maxLength={120} placeholder="CPF, celular, e-mail ou chave aleatória" value={form.pixKey} onChange={(e) => setFormValue('pixKey', e.target.value)} />}</Field>
          <Field label="Observações / notas">{(id) => <textarea id={id} className="input person-notes-input" rows="3" maxLength={1000} value={form.notes} onChange={(e) => setFormValue('notes', e.target.value)} />}</Field>
        </div>
      </Modal>

      <Modal
        open={!!billingPerson}
        title={`Demonstrativo de cobrança${billingPerson ? ` · ${billingPerson.name}` : ''}`}
        wide
        footer={<>
          {billing && billing.grandTotalPending > 0 && (
            <Button variant="primary" onClick={settleMonth} disabled={billingLoading || settlingMonth}>
              <Check size={16} aria-hidden="true" />
              {settlingMonth ? 'Quitando…' : 'Quitar Tudo do Mês'}
            </Button>
          )}
          <Button variant="ghost" onClick={copyMessage} disabled={billingLoading || !billing}>{copied ? 'Copiado!' : 'Copiar mensagem'}</Button>
          <Button variant="ghost" onClick={closeBilling}>Fechar</Button>
          {billing?.whatsappLink && <a className="btn btn-primary" href={billing.whatsappLink} target="_blank" rel="noreferrer">Abrir no WhatsApp ↗</a>}
        </>}
      >
        <div className="billing-period">
          <span className="muted small">Período</span>
          <select className="input" aria-label="Mês do demonstrativo" value={modalMonth} onChange={changeBillingMonth}>
            {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map((name, index) => (
              <option key={name} value={index + 1}>{name}</option>
            ))}
          </select>
          <select className="input" aria-label="Ano do demonstrativo" value={modalYear} onChange={changeBillingYear}>
            {Array.from({ length: 101 }, (_, index) => 2000 + index).map((optionYear) => (
              <option key={optionYear} value={optionYear}>{optionYear}</option>
            ))}
          </select>
        </div>
        {billingLoading ? <Spinner label="Gerando demonstrativo…" /> : billing ? (
          <div className="billing-preview">
            <p className="muted small">{`Referência: ${String(modalMonth).padStart(2, '0')}/${modalYear}`}</p>
            {!billingPerson?.phone && <p className="billing-warning">Sem telefone cadastrado. Você ainda pode copiar a mensagem e enviá-la manualmente.</p>}
            <div className="billing-totals">
              <span>Total do mês <Money value={billing.grandTotal ?? billing.totalAmount} strong /></span>
              <span>Saldo restante <Money value={billing.grandTotalPending ?? billing.totalPending} strong /></span>
            </div>
            <pre className="billing-message">{billing.formattedMessage}</pre>
          </div>
        ) : billingError ? (
          <EmptyState title="Não foi possível gerar o demonstrativo">Tente novamente. Se o erro persistir, verifique a conexão com a API.</EmptyState>
        ) : null}
      </Modal>
    </>
  );
}
