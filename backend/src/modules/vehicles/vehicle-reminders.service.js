import { badRequest, notFound } from '../../lib/errors.js';
import { Vehicle } from '../../models/Vehicle.js';
import { VehicleReminder } from '../../models/VehicleReminder.js';
import { User } from '../../models/User.js';

const TYPES = {
  oil: 'Óleo', tires: 'Pneus', review: 'Revisão', ipva: 'IPVA',
  insurance: 'Seguro', licensing: 'Licenciamento', other: 'Outro',
};
const RULES = { km: 'Por km', time: 'Por tempo', km_or_time: 'Por km ou tempo', fixed_date: 'Data fixa' };
const DAY_MS = 86400000;
const isoToday = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`);
const daysBetween = (from, to) => Math.round((dayNumber(to) - dayNumber(from)) / DAY_MS);

function addMonths(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function evaluateReminder(reminder, vehicle, today = isoToday(), settings = { daysBefore: 30, kmBefore: 500 }) {
  if (!reminder.active) return { status: 'paid', statusLabel: 'Pago', targetDate: null, targetKm: null };
  const baseline = reminder.lastPerformedDate || isoToday(reminder.createdAt ?? new Date());
  const targetDate = reminder.rule === 'fixed_date'
    ? reminder.dueDate
    : reminder.intervalMonths ? addMonths(baseline, reminder.intervalMonths) : null;
  const targetKm = reminder.intervalKm != null && reminder.lastPerformedKm != null
    ? reminder.lastPerformedKm + reminder.intervalKm : null;
  const dateRemaining = targetDate ? daysBetween(today, targetDate) : null;
  const kmRemaining = targetKm != null && vehicle.currentKm != null ? targetKm - vehicle.currentKm : null;
  const overdue = (dateRemaining != null && dateRemaining < 0) || (kmRemaining != null && kmRemaining < 0);
  const upcoming = (dateRemaining != null && dateRemaining >= 0 && dateRemaining <= settings.daysBefore)
    || (kmRemaining != null && kmRemaining >= 0 && kmRemaining <= settings.kmBefore);
  const status = overdue ? 'overdue' : upcoming ? 'upcoming' : 'on_track';
  return {
    status,
    statusLabel: status === 'overdue' ? 'Vencido' : status === 'upcoming' ? 'Em breve' : 'Em dia',
    targetDate, targetKm, dateRemaining, kmRemaining,
  };
}

function reminderShape(reminder, vehicle, today, settings) {
  const computed = evaluateReminder(reminder, vehicle, today, settings);
  const title = reminder.type === 'other' ? reminder.title : TYPES[reminder.type];
  const parts = [];
  if (computed.targetDate) parts.push(`Vencimento ${computed.targetDate.split('-').reverse().join('/')}`);
  if (computed.targetKm != null) parts.push(`em ${computed.targetKm.toLocaleString('pt-BR')} km`);
  return {
    id: String(reminder._id), vehicleId: String(reminder.vehicleId), vehicleModel: vehicle.model,
    title, type: reminder.type, typeLabel: TYPES[reminder.type], rule: reminder.rule,
    source: reminder.source,
    ruleLabel: RULES[reminder.rule], intervalKm: reminder.intervalKm, intervalMonths: reminder.intervalMonths,
    dueDate: reminder.dueDate, lastPerformedDate: reminder.lastPerformedDate,
    lastPerformedKm: reminder.lastPerformedKm, active: reminder.active, paidAt: reminder.paidAt,
    ...computed, description: parts.join(' · ') || RULES[reminder.rule],
  };
}

function validateRule(data) {
  if (data.rule === 'km' && !data.intervalKm) throw badRequest('Informe o intervalo em km.');
  if (data.rule === 'time' && !data.intervalMonths) throw badRequest('Informe o intervalo em meses.');
  if (data.rule === 'km_or_time' && (!data.intervalKm || !data.intervalMonths)) throw badRequest('Informe os intervalos em km e meses.');
  if (data.rule === 'fixed_date' && !data.dueDate) throw badRequest('Informe a data de vencimento.');
  if (data.type === 'other' && !data.title?.trim()) throw badRequest('Informe o nome do lembrete.');
}

export async function listVehicleReminders(userId, vehicleId, today = isoToday()) {
  const filter = { userId, ...(vehicleId && { vehicleId }) };
  const [reminders, vehicles, user] = await Promise.all([
    VehicleReminder.find(filter).sort({ active: -1, updatedAt: -1 }).lean(),
    Vehicle.find({ userId, ...(vehicleId && { _id: vehicleId }) }).select('model currentKm').lean(),
    User.findById(userId).select('vehicleReminderSettings').lean(),
  ]);
  const settings = { daysBefore: 30, kmBefore: 500, ...(user?.vehicleReminderSettings ?? {}) };
  const vehicleMap = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle]));
  const statusOrder = { overdue: 0, upcoming: 1, on_track: 2, paid: 3 };
  const urgency = (reminder) => Math.min(reminder.dateRemaining ?? Infinity, reminder.kmRemaining ?? Infinity);
  return reminders
    .filter((reminder) => vehicleMap.has(String(reminder.vehicleId)))
    .map((reminder) => reminderShape(reminder, vehicleMap.get(String(reminder.vehicleId)), today, settings))
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || urgency(a) - urgency(b));
}

export async function getVehicleReminderSettings(userId) {
  const user = await User.findById(userId).select('vehicleReminderSettings').lean();
  return { daysBefore: user?.vehicleReminderSettings?.daysBefore ?? 30, kmBefore: user?.vehicleReminderSettings?.kmBefore ?? 500 };
}

export async function saveVehicleReminderSettings(userId, settings) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { 'vehicleReminderSettings.daysBefore': settings.daysBefore, 'vehicleReminderSettings.kmBefore': settings.kmBefore } },
    { returnDocument: 'after', runValidators: true },
  ).select('vehicleReminderSettings').lean();
  return { daysBefore: user.vehicleReminderSettings.daysBefore, kmBefore: user.vehicleReminderSettings.kmBefore };
}

export async function createVehicleReminder(userId, data) {
  validateRule(data);
  const vehicle = await Vehicle.findOne({ _id: data.vehicleId, userId }).select('currentKm').lean();
  if (!vehicle) throw notFound('Veículo não encontrado');
  const today = isoToday();
  const reminder = await VehicleReminder.create({
    userId, vehicleId: data.vehicleId, type: data.type, title: data.title?.trim() ?? '',
    rule: data.rule, intervalKm: data.intervalKm ?? null, intervalMonths: data.intervalMonths ?? null,
    dueDate: data.dueDate ?? null, lastPerformedDate: data.lastPerformedDate || (data.rule === 'fixed_date' ? null : today),
    lastPerformedKm: data.lastPerformedKm ?? (['km', 'km_or_time'].includes(data.rule) ? vehicle.currentKm : null),
  });
  return (await listVehicleReminders(userId, data.vehicleId)).find((item) => item.id === String(reminder._id));
}

export async function updateVehicleReminder(userId, id, data) {
  validateRule(data);
  const vehicle = await Vehicle.findOne({ _id: data.vehicleId, userId }).select('currentKm').lean();
  if (!vehicle) throw notFound('Veículo não encontrado');
  const reminder = await VehicleReminder.findOne({ _id: id, userId });
  if (!reminder) throw notFound('Lembrete não encontrado');
  if (reminder.source !== 'manual') throw badRequest('Este lembrete é atualizado pelos dados do veículo ou do documento.');
  Object.assign(reminder, {
    vehicleId: data.vehicleId, type: data.type, title: data.title?.trim() ?? '',
    rule: data.rule, intervalKm: data.intervalKm ?? null, intervalMonths: data.intervalMonths ?? null,
    dueDate: data.dueDate ?? null, lastPerformedDate: data.lastPerformedDate ?? null,
    lastPerformedKm: data.lastPerformedKm ?? null, active: true, paidAt: null, notifiedStatus: null,
  });
  await reminder.save();
  return (await listVehicleReminders(userId, data.vehicleId)).find((item) => item.id === String(reminder._id));
}

export async function removeVehicleReminder(userId, id) {
  const reminder = await VehicleReminder.findOne({ _id: id, userId });
  if (!reminder) throw notFound('Lembrete não encontrado');
  if (reminder.source !== 'manual') throw badRequest('Este lembrete é atualizado pelos dados do veículo ou do documento.');
  await reminder.deleteOne();
}

export async function markVehicleReminderPaid(userId, id, today = isoToday()) {
  const reminder = await VehicleReminder.findOne({ _id: id, userId });
  if (!reminder) throw notFound('Lembrete não encontrado');
  if (reminder.rule !== 'fixed_date') throw badRequest('Ação disponível apenas para lembretes de data fixa.');
  if (reminder.source === 'document') throw badRequest('Atualize ou substitua o documento para alterar este vencimento.');
  reminder.active = false;
  reminder.paidAt = today;
  reminder.notifiedStatus = null;
  await reminder.save();
  return (await listVehicleReminders(userId, reminder.vehicleId)).find((item) => item.id === String(reminder._id));
}

export async function completeReminderFromExpense(userId, reminderId, data, session) {
  const reminder = await VehicleReminder.findOne({
    _id: reminderId, userId, vehicleId: data.vehicleId, active: true,
  }).session(session);
  if (!reminder) throw badRequest('Lembrete inválido ou inativo.');
  const vehicle = await Vehicle.findOne({ _id: data.vehicleId, userId }).select('currentKm').session(session).lean();
  reminder.lastPerformedDate = data.date;
  reminder.lastPerformedKm = data.km ?? vehicle?.currentKm ?? reminder.lastPerformedKm;
  reminder.notifiedStatus = null;
  if (reminder.rule === 'fixed_date') {
    reminder.active = false;
    reminder.paidAt = data.date;
  }
  await reminder.save({ session });
}

export async function getVehicleReminderAlerts(userId, today = isoToday()) {
  const reminders = await listVehicleReminders(userId, undefined, today);
  const alerts = [];
  for (const reminder of reminders) {
    const alertStatus = reminder.status === 'overdue' ? 'overdue' : reminder.status === 'upcoming' ? 'upcoming' : null;
    if (!alertStatus) {
      await VehicleReminder.updateOne(
        { _id: reminder.id, userId, notifiedStatus: { $ne: null } },
        { $set: { notifiedStatus: null } },
      );
      continue;
    }
    const result = await VehicleReminder.updateOne(
      { _id: reminder.id, userId, notifiedStatus: { $ne: alertStatus } },
      { $set: { notifiedStatus: alertStatus } },
    );
    if (!result.modifiedCount) continue;
    alerts.push({
      id: `vehicle-${reminder.id}`, type: 'vehicle_reminder',
      title: `${reminder.title} • ${reminder.vehicleModel}`,
      description: reminder.description, amount: null, dueDate: reminder.targetDate,
      status: alertStatus, severity: alertStatus === 'overdue' ? 'danger' : 'warning',
      link: `/veiculos/${reminder.vehicleId}?tab=maintenance`,
    });
  }
  return alerts;
}
