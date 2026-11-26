import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Check, Copy, Link2, MessageCircle, Pencil } from 'lucide-react';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { remindersApi, peopleApi, systemApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Field, Modal, Money, PageHeader, Spinner } from '../../components/ui/ui.jsx';
import { MONTHS } from '../../lib/format.js';

const nameCollator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const compareByName = (a, b) => nameCollator.compare(a.name ?? '', b.name ?? '');

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

function BillingMessage({ message }) {
  const parts = message.split(/(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g);
  return (
    <pre className="billing-message">
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('*') && part.endsWith('*')) return <strong key={index}>{part.slice(1, -1)}</strong>;
        if (part.startsWith('__') && part.endsWith('__')) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('_') && part.endsWith('_')) return <em key={index}>{part.slice(1, -1)}</em>;
        return part;
      })}
    </pre>
  );
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

export function PersonAvatar({ person }) {
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

export function PersonEditorModal({ open, person, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    if (!open) return;
    setForm(person ? {
      name: person.name || '',
      phone: maskPhone(person.phone || ''),
      email: person.email || '',
      birthDate: person.birth_date || '',
      pixKey: person.pix_key || '',
      avatar: person.avatar || null,
      notes: person.notes || '',
    } : { ...emptyForm });
    setSaving(false);
  }, [open, person]);

  const setFormValue = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const changeAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setFormValue('avatar', await processAvatarImage(file));
    } catch (error) {
      toast.error(error);
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
      if (person) await peopleApi.update(person.id, payload);
      else await peopleApi.create(payload);
      toast.success(person ? 'Pessoa atualizada' : 'Pessoa adicionada');
      onClose();
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={person ? 'Editar pessoa' : 'Nova pessoa'}
      wide
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar'}</Button></>}
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
        <Field label="Nome completo *">{(id) => <input id={id} className="input" value={form.name} onChange={(event) => setFormValue('name', event.target.value)} autoFocus required maxLength={60} />}</Field>
        <Field label="WhatsApp / celular">{(id) => <input id={id} className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" value={form.phone} onChange={(event) => setFormValue('phone', maskPhone(event.target.value))} />}</Field>
        <Field label="E-mail">{(id) => <input id={id} className="input" type="email" autoComplete="email" maxLength={254} value={form.email} onChange={(event) => setFormValue('email', event.target.value)} />}</Field>
        <Field label="Data de nascimento">{(id) => <input id={id} className="input" type="date" value={form.birthDate} onChange={(event) => setFormValue('birthDate', event.target.value)} />}</Field>
        <Field label="Chave Pix">{(id) => <input id={id} className="input" maxLength={120} placeholder="CPF, celular, e-mail ou chave aleatória" value={form.pixKey} onChange={(event) => setFormValue('pixKey', event.target.value)} />}</Field>
        <Field label="Observações / notas">{(id) => <textarea id={id} className="input person-notes-input" rows="3" maxLength={1000} value={form.notes} onChange={(event) => setFormValue('notes', event.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

async function removePerson(person, toast) {
  if (!window.confirm(`Excluir ${person.name}? Compras e planilhas dessa pessoa também serão apagadas.`)) return false;
  try {
    await peopleApi.remove(person.id);
    toast.success('Pessoa excluída');
    return true;
  } catch (error) {
    toast.error(error);
    return false;
  }
}

export function PersonProfileMenu({ person, onEdit, onDeleted }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const deletePerson = async () => {
    setOpen(false);
    if (await removePerson(person, toast)) onDeleted();
  };

  return (
    <div className="person-profile-menu-wrap" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="person-profile-menu-trigger"
        aria-label={`Ações de ${person.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Pencil size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="person-profile-menu" role="menu" aria-label={`Ações de ${person.name}`}>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>Editar</button>
          <button type="button" role="menuitem" onClick={deletePerson}>Excluir</button>
        </div>
      )}
    </div>
  );
}

export default function PeoplePage({
  initialBillingPersonId = null,
  onlyPersonId = null,
  showHeader = true,
  headerContent = null,
  profileCard = false,
  onAddPhone = null,
} = {}) {
  const { month, year } = usePeriod();
  const toast = useToast();
  const { data, error, reload } = useFetch(() => peopleApi.list(), [], { cacheKey: 'lookup:people', refreshEvent: 'people:refresh' });
  const portalContact = useFetch(() => systemApi.getPortalContact(), [], { enabled: !profileCard });
  const [editing, setEditing] = useState(null);
  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [billingPerson, setBillingPerson] = useState(null);
  const [billing, setBilling] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [settlingMonth, setSettlingMonth] = useState(false);
  const [billingError, setBillingError] = useState(false);
  const [modalMonth, setModalMonth] = useState(month || new Date().getMonth() + 1);
  const [modalYear, setModalYear] = useState(year || new Date().getFullYear());
  const [copied, setCopied] = useState(false);
  const billingRequest = useRef(0);
  const initialBillingOpened = useRef(null);

  useEffect(() => {
    if (!initialBillingPersonId || !data || initialBillingOpened.current === initialBillingPersonId) return;
    const person = data.find((item) => item.id === initialBillingPersonId);
    if (person) {
      initialBillingOpened.current = initialBillingPersonId;
      if (profileCard) {
        const initialMonth = month || new Date().getMonth() + 1;
        const initialYear = year || new Date().getFullYear();
        setModalMonth(initialMonth);
        setModalYear(initialYear);
        fetchBilling(person.id, initialMonth, initialYear);
      } else {
        openBilling(person);
      }
    }
  }, [data, initialBillingPersonId, profileCard]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;

  const visiblePeople = (onlyPersonId
    ? data.filter((person) => person.id === onlyPersonId)
    : data).slice().sort(compareByName);

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
    setPersonModalOpen(true);
  };
  const openEdit = (person) => {
    setEditing(person);
    setPersonModalOpen(true);
  };
  const closePersonModal = () => {
    setPersonModalOpen(false);
    setEditing(null);
  };
  const remove = (person) => removePerson(person, toast);
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
      {showHeader && <PageHeader
        title="Pessoas"
        subtitle="Gerencie participantes, contatos, aniversários e demonstrativos de cobrança"
        actions={<Button variant="primary" onClick={openCreate}>Nova pessoa</Button>}
      />}
      {headerContent}
      {visiblePeople.length === 0 ? (
        onlyPersonId
          ? <EmptyState title="Pessoa não encontrada">Volte para Pessoas para selecionar outra pessoa.</EmptyState>
          : <Card><EmptyState title="Ninguém cadastrado">Adicione pessoas para associar aos gastos e cobranças.</EmptyState><Button variant="primary" onClick={openCreate}>Cadastrar a primeira pessoa</Button></Card>
      ) : (
        <section className="person-grid" aria-label="Pessoas cadastradas">
          {visiblePeople.map((person) => {
            if (profileCard) {
              return (
                <Card className="person-billing-card" key={person.id}>
                  <div className="person-billing-overview">
                    <div className="person-billing-total">
                      <span className="muted small">Valor a cobrar</span>
                      {billingLoading && !billing ? <Spinner /> : billing ? (
                        <Money value={billing.grandTotalPending ?? billing.totalPending ?? 0} strong />
                      ) : billingError ? (
                        <Button size="sm" variant="ghost" onClick={() => fetchBilling(person.id, modalMonth, modalYear)}>Tentar novamente</Button>
                      ) : <Spinner />}
                    </div>
                    <div className="person-billing-purchases">
                      <strong>{person.purchases ?? 0}</strong>
                      <span className="muted small">compras registradas</span>
                    </div>
                  </div>
                  {person.phone ? (
                    <p className="person-billing-phone">{maskPhone(person.phone)}</p>
                  ) : (
                    <p className="person-billing-phone muted">
                      Sem telefone cadastrado.{' '}
                      <button type="button" className="person-add-phone" onClick={onAddPhone}>Adicionar telefone</button>
                    </p>
                  )}
                  <div className="person-billing-actions">
                    <Button variant="primary" onClick={() => openBilling(person)}>
                      <MessageCircle size={16} aria-hidden="true" /> Cobrar no WhatsApp
                    </Button>
                    <Button variant="ghost" onClick={() => copyPortalLink(person)}>
                      <Link2 size={16} aria-hidden="true" /> Portal
                    </Button>
                  </div>
                </Card>
              );
            }
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
                  <Link className="btn btn-ghost btn-sm person-monthly-link" to={`/pessoas/${person.id}/planilha/${new Date().getFullYear()}`}>
                    <CalendarDays size={15} aria-hidden="true" /> Mês a mês
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(person)}>Editar</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(person)}>Excluir</Button>
                </div>
              </Card>
            );
          })}
        </section>
      )}

      <PersonEditorModal open={personModalOpen} person={editing} onClose={closePersonModal} />

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
          <span className="muted small">Mês de vencimento</span>
          <select className="input" aria-label="Mês de vencimento do demonstrativo" value={modalMonth} onChange={changeBillingMonth}>
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
            <p className="muted small">{`Vencimentos: ${String(modalMonth).padStart(2, '0')}/${modalYear}`}</p>
            {!billingPerson?.phone && <p className="billing-warning">Sem telefone cadastrado. Você ainda pode copiar a mensagem e enviá-la manualmente.</p>}
            <div className="billing-totals">
              <span>Total do mês <Money value={billing.grandTotal ?? billing.totalAmount} strong /></span>
              <span>Saldo restante <Money value={billing.grandTotalPending ?? billing.totalPending} strong /></span>
            </div>
            <BillingMessage message={billing.formattedMessage} />
          </div>
        ) : billingError ? (
          <EmptyState title="Não foi possível gerar o demonstrativo">Tente novamente. Se o erro persistir, verifique a conexão com a API.</EmptyState>
        ) : null}
      </Modal>
    </>
  );
}
