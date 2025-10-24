import cron from "node-cron";
import Reminder from "../models/Reminder.js";
import CloudApiService from "../services/cloudApiService.js";
import { devLog } from "../helpers/logger.js";
import { formatPhoneNumber } from "../utils/formatPhone.js";
import dotenv from 'dotenv';

dotenv.config();

async function checkAndSendReminders() {
  const now = new Date();
  devLog(`[ReminderJob] Executando... Verificando lembretes para antes de ${now.toISOString()}`);

  try {
    // Process early reminders
    const earlyReminders = await Reminder.find({
      status: 'pending',
      earlyReminderDate: { $lte: now }
    }).populate({ path: 'userId', model: 'User', select: 'phoneNumber' });

    for (const reminder of earlyReminders) {
      if (!reminder.userId?.phoneNumber) continue;
      const recipient = formatPhoneNumber(reminder.userId.phoneNumber);

      const earlyDescription = `LEMBRETE ANTECIPADO: ${reminder.description}`;
      
      devLog("[ReminderJob] MODO PRODUÇÃO: Enviando lembrete antecipado via Cloud API.");
      const cloudApiService = new CloudApiService();
      await cloudApiService.sendTextMessage(recipient, `🔔 ${earlyDescription}`);
      
      devLog(`[ReminderJob] Lembrete antecipado #${reminder.messageId} enviado para ${recipient}.`);

      reminder.earlyReminderDate = null;
      await reminder.save();
    }

    // Process main reminders
    const mainReminders = await Reminder.find({
      status: 'pending',
      date: { $lte: now }
    }).populate({ path: 'userId', model: 'User', select: 'phoneNumber' });

    for (const reminder of mainReminders) {
      if (!reminder.userId?.phoneNumber) continue;
      const recipient = formatPhoneNumber(reminder.userId.phoneNumber);

      const message = `🔔 Lembrete: ${reminder.description}`;

      devLog("[ReminderJob] MODO PRODUÇÃO: Enviando lembrete principal via Cloud API.");
      const cloudApiService = new CloudApiService();
      await cloudApiService.sendTextMessage(recipient, message);
      
      devLog(`[ReminderJob] Lembrete principal #${reminder.messageId} enviado para ${recipient}.`);
      
      await Reminder.findByIdAndDelete(reminder._id);
      devLog(`[ReminderJob] Lembrete #${reminder.messageId} excluído.`);
    }

    if (earlyReminders.length === 0 && mainReminders.length === 0) {
      devLog("[ReminderJob] Nenhum lembrete para enviar.");
    }

  } catch (error) {
    devLog("[ReminderJob] Erro geral ao processar lembretes:", error);
  }
}

export function startReminderJob() {
  devLog("[Scheduler] Job de lembretes iniciado. Verificando a cada minuto.");
  cron.schedule("* * * * *", () => {
    checkAndSendReminders();
  });
}