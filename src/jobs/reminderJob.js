import cron from "node-cron";
import Reminder from "../models/Reminder.js";
import { sendTemplateMessage } from "../services/twilioService.js";
import { devLog } from "../helpers/logger.js";
import { formatPhoneNumber } from "../utils/formatPhone.js";
import dotenv from 'dotenv';

dotenv.config();

async function checkAndSendReminders() {
  const now = new Date();
  devLog(`[ReminderJob] Executando... Verificando lembretes para antes de ${now.toISOString()}`);

  try {
    const earlyReminders = await Reminder.find({
      status: 'pending',
      earlyReminderDate: { $lte: now }
    }).populate({ path: 'userId', model: 'User', select: 'phoneNumber' });

    for (const reminder of earlyReminders) {
      if (!reminder.userId?.phoneNumber) continue;
      const recipient = formatPhoneNumber(reminder.userId.phoneNumber);
      const templateSid = process.env.TWILIO_REMINDER_TEMPLATE_SID;

      const earlyDescription = `LEMBRETE ANTECIPADO: ${reminder.description}`;
      await sendTemplateMessage(recipient, templateSid, { '1': earlyDescription });
      devLog(`[ReminderJob] Lembrete antecipado #${reminder.messageId} enviado para ${recipient}.`);

      reminder.earlyReminderDate = null;
      await reminder.save();
    }

    const mainReminders = await Reminder.find({
      status: 'pending',
      date: { $lte: now }
    }).populate({ path: 'userId', model: 'User', select: 'phoneNumber' });

    for (const reminder of mainReminders) {
      if (!reminder.userId?.phoneNumber) continue;
      const recipient = formatPhoneNumber(reminder.userId.phoneNumber);
      const templateSid = process.env.TWILIO_REMINDER_TEMPLATE_SID;

      await sendTemplateMessage(recipient, templateSid, { '1': reminder.description });
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