import cron from "node-cron";
import Reminder from "../models/Reminder.js";
import User from "../models/User.js"; // 1. Importe o modelo User
import { sendTemplateMessage } from "../services/twilioService.js";
import { devLog } from "../helpers/logger.js";
import { formatPhoneNumber } from "../utils/formatPhone.js";
import dotenv from 'dotenv';

dotenv.config();

async function checkAndSendReminders() {
  const now = new Date();
  devLog(`[ReminderJob] Executando... Verificando lembretes para antes de ${now.toISOString()}`);

  try {
    const dueReminders = await Reminder.find({
      date: { $lte: now },
      status: 'pending'
    }).populate({
      path: 'userId',
      model: User,
      select: 'phoneNumber name'
    });

    if (dueReminders.length === 0) {
      devLog("[ReminderJob] Nenhum lembrete para enviar.");
      return;
    }

    devLog(`[ReminderJob] Encontrou ${dueReminders.length} lembrete(s) para enviar.`);

    const templateSid = process.env.TWILIO_REMINDER_TEMPLATE_SID;

    for (const reminder of dueReminders) {
      if (!reminder.userId || !reminder.userId.phoneNumber) {
          devLog(`[ReminderJob] Lembrete #${reminder.messageId} para usuário desconhecido ou sem número. Pulando.`);
          continue;
      }
      
      try {
        const recipient = formatPhoneNumber(reminder.userId.phoneNumber);

        const templateVariables = {
          '1': reminder.description,
        };

        await sendTemplateMessage(recipient, templateSid, templateVariables);
        devLog(`[ReminderJob] Lembrete #${reminder.messageId} enviado para ${recipient}.`);

        await Reminder.updateOne({ _id: reminder._id }, { $set: { status: 'completed' } });
        devLog(`[ReminderJob] Lembrete #${reminder.messageId} marcado como concluído.`);
        
      } catch (sendError) {
        devLog(`[ReminderJob] Falha ao enviar lembrete #${reminder.messageId}. Erro:`, sendError);
      }
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