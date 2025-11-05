import cron from "node-cron";
import Reminder from "../models/Reminder.js";
import CloudApiService from "../services/cloudApiService.js";
import { devLog } from "../helpers/logger.js";
import { formatPhoneNumber } from "../utils/formatPhone.js";
import { getCurrentDateInBrazil, convertFromUTCForProcessing, formatDateTimeInBrazil } from "../utils/dateUtils.js";
import dotenv from 'dotenv';

dotenv.config();

async function checkAndSendReminders() {
  const nowBrazil = getCurrentDateInBrazil();
  const nowUTC = new Date(); // Keep UTC for database queries
  
  devLog(`[ReminderJob] Executando... Verificando lembretes para antes de ${formatDateTimeInBrazil(nowBrazil)} (Brazil) / ${nowUTC.toISOString()} (UTC)`);

  try {
    // Process early reminders
    const earlyReminders = await Reminder.find({
      status: 'pending',
      earlyReminderDate: { $lte: nowUTC }
    }).populate({ path: 'userId', model: 'User', select: 'phoneNumber' });

    devLog(`[ReminderJob] Encontrados ${earlyReminders.length} lembretes antecipados para processar.`);

    for (const reminder of earlyReminders) {
      if (!reminder.userId?.phoneNumber) continue;
      const recipient = formatPhoneNumber(reminder.userId.phoneNumber);

      // Convert UTC dates to Brazil timezone for logging
      const earlyReminderBrazilTime = convertFromUTCForProcessing(reminder.earlyReminderDate);
      
      const earlyDescription = `LEMBRETE ANTECIPADO: ${reminder.description}`;
      
      devLog(`[ReminderJob] MODO PRODUÇÃO: Enviando lembrete antecipado via Cloud API. Agendado para: ${formatDateTimeInBrazil(earlyReminderBrazilTime)} (Brazil)`);
      const cloudApiService = new CloudApiService();
      await cloudApiService.sendTextMessage(recipient, `🔔 ${earlyDescription}`);
      
      devLog(`[ReminderJob] Lembrete antecipado #${reminder.messageId} enviado para ${recipient} às ${formatDateTimeInBrazil(nowBrazil)} (Brazil).`);

      reminder.earlyReminderDate = null;
      await reminder.save();
    }

    // Process main reminders
    const mainReminders = await Reminder.find({
      status: 'pending',
      date: { $lte: nowUTC }
    }).populate({ path: 'userId', model: 'User', select: 'phoneNumber' });

    devLog(`[ReminderJob] Encontrados ${mainReminders.length} lembretes principais para processar.`);

    for (const reminder of mainReminders) {
      if (!reminder.userId?.phoneNumber) continue;
      const recipient = formatPhoneNumber(reminder.userId.phoneNumber);

      // Convert UTC dates to Brazil timezone for logging
      const reminderBrazilTime = convertFromUTCForProcessing(reminder.date);

      const message = `🔔 Lembrete: ${reminder.description}`;

      devLog(`[ReminderJob] MODO PRODUÇÃO: Enviando lembrete principal via Cloud API. Agendado para: ${formatDateTimeInBrazil(reminderBrazilTime)} (Brazil)`);
      const cloudApiService = new CloudApiService();
      await cloudApiService.sendTextMessage(recipient, message);
      
      devLog(`[ReminderJob] Lembrete principal #${reminder.messageId} enviado para ${recipient} às ${formatDateTimeInBrazil(nowBrazil)} (Brazil).`);
      
      await Reminder.findByIdAndDelete(reminder._id);
      devLog(`[ReminderJob] Lembrete #${reminder.messageId} excluído.`);
    }

    if (earlyReminders.length === 0 && mainReminders.length === 0) {
      devLog(`[ReminderJob] Nenhum lembrete para enviar às ${formatDateTimeInBrazil(nowBrazil)} (Brazil).`);
    }

  } catch (error) {
    devLog(`[ReminderJob] Erro geral ao processar lembretes às ${formatDateTimeInBrazil(nowBrazil)} (Brazil):`, error);
  }
}

export function startReminderJob() {
  const startTime = getCurrentDateInBrazil();
  devLog(`[Scheduler] Job de lembretes iniciado às ${formatDateTimeInBrazil(startTime)} (Brazil). Verificando a cada minuto.`);
  devLog(`[Scheduler] Timezone configurado: America/Sao_Paulo`);
  
  cron.schedule("* * * * *", () => {
    checkAndSendReminders();
  });
}