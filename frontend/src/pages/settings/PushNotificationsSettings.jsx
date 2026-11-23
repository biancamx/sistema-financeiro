import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, ShieldCheck, Smartphone } from 'lucide-react';
import { Button, Card } from '../../components/ui/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { pushApi } from '../../services/api.js';

function supportsPushNotifications() {
  return Boolean(
    globalThis.isSecureContext
    && 'Notification' in globalThis
    && 'serviceWorker' in navigator
    && 'PushManager' in globalThis,
  );
}

function decodeVapidKey(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

const statusText = {
  checking: 'Verificando este dispositivo…',
  unsupported: 'Não suportado neste navegador ou contexto.',
  blocked: 'Bloqueado nas permissões do navegador. Para reativar, altere as permissões do site nas configurações do iPhone.',
  enabled: 'Ativado neste dispositivo para a conta atual.',
  inactive: 'Desativado neste dispositivo.',
};

export default function PushNotificationsSettings() {
  const supported = supportsPushNotifications();
  const [status, setStatus] = useState('checking');
  const [hasSubscription, setHasSubscription] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const toast = useToast();

  useEffect(() => {
    let active = true;
    async function inspectSubscription() {
      if (!supported) {
        setStatus('unsupported');
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        const subscription = await registration.pushManager.getSubscription();
        if (!active) return;
        setHasSubscription(Boolean(subscription));
        if (Notification.permission === 'denied') {
          setStatus('blocked');
          return;
        }
        if (!subscription || Notification.permission !== 'granted') {
          setStatus('inactive');
          return;
        }
        await pushApi.saveSubscription({
          subscription: subscription.toJSON(),
          userAgent: navigator.userAgent,
        });
        if (active) setStatus('enabled');
      } catch (error) {
        if (!active) return;
        setStatus(Notification.permission === 'denied' ? 'blocked' : 'inactive');
        setMessage(error.message);
      }
    }
    inspectSubscription();
    return () => { active = false; };
  }, [supported]);

  async function activate() {
    if (!supported || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'inactive');
        if (permission === 'denied') {
          setMessage('Permita notificações nas configurações do iPhone para ativá-las.');
        }
        return;
      }

      const registration = await navigator.serviceWorker.register('/service-worker.js');
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const publicKey = await pushApi.getVapidPublicKey();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey),
        });
      }
      await pushApi.saveSubscription({
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
      });
      setHasSubscription(true);
      setStatus('enabled');
      toast.success('Notificações ativadas neste dispositivo.');
    } catch (error) {
      setMessage(error.message);
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!supported || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await pushApi.removeSubscription(subscription.endpoint);
        const removed = await subscription.unsubscribe();
        if (!removed) throw new Error('O navegador não conseguiu desativar esta assinatura.');
      }
      setHasSubscription(false);
      setStatus(Notification.permission === 'denied' ? 'blocked' : 'inactive');
      toast.success('Notificações desativadas neste dispositivo.');
    } catch (error) {
      setMessage(error.message);
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!hasSubscription || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await pushApi.sendTest();
      if (result.sent > 0) toast.success('Notificação de teste enviada ao celular.');
      else toast.error('Nenhum dispositivo recebeu o teste. Verifique se as notificações estão ativadas neste celular.');
    } catch (error) {
      setMessage(error?.message || 'Não foi possível enviar a notificação de teste.');
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="settings-card">
      <header className="settings-card-head">
        <div className="settings-icon"><Smartphone aria-hidden="true" /></div>
        <div className="settings-card-copy">
          <h2>Notificações no celular</h2>
          <p>Receba no dispositivo avisos de aniversários e de faturas que vencem hoje ou estão atrasadas, mesmo com o app fechado.</p>
        </div>
      </header>
      <div className="settings-push-content">
        <p className={`settings-push-status is-${status}`} role="status">
          {status === 'enabled' ? <BellRing aria-hidden="true" /> : status === 'blocked' || status === 'unsupported' ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
          <span>{statusText[status]}</span>
        </p>
        {message && <p className="settings-ai-message is-error">{message}</p>}
        <p className="settings-push-help">
          No iPhone, instale o app pela opção <strong>Adicionar à Tela de Início</strong> e use iOS/iPadOS 16.4 ou posterior. As notificações são enviadas somente aos dispositivos inscritos na sua conta.
        </p>
        <div className="settings-ai-actions">
          {hasSubscription ? (
            <>
              <Button variant="primary" onClick={sendTest} disabled={busy}>
                <BellRing aria-hidden="true" /> {busy ? 'Enviando…' : 'Enviar notificação de teste'}
              </Button>
              <Button variant="ghost" onClick={deactivate} disabled={busy}>
                <BellOff aria-hidden="true" /> {busy ? 'Desativando…' : 'Desativar neste dispositivo'}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={activate} disabled={!supported || status === 'checking' || status === 'blocked' || busy}>
              <BellRing aria-hidden="true" /> {busy ? 'Ativando…' : 'Ativar notificações no celular'}
            </Button>
          )}
          <span className="settings-push-private"><ShieldCheck aria-hidden="true" /> Notificações financeiras privadas da sua conta</span>
        </div>
      </div>
    </Card>
  );
}
