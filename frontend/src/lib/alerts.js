import { remindersApi } from '../services/api.js';

export async function dismissAlert(alert, toast) {
  if (!alert?.alertKey) return false;
  try {
    await remindersApi.dismissAlert(alert.alertKey);
    window.dispatchEvent(new Event('reminders:refresh'));
    toast.success('Notificação removida da central.');
    return true;
  } catch (error) {
    toast.error(error);
    return false;
  }
}
