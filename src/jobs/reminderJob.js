import cron from "node-cron";
import Reminder from "../models/Reminder.js";
import { sendTemplateMessage } from "../services/twilioService.js";
import { devLog } from "../helpers/logger.js";
import { formatPhoneNumber } from "../utils/formatPhone.js";
import dotenv from 'dotenv';

dotenv.config();

async function checkAndSendReminders() {
  const now = new Date();
  devLog(
    `[ReminderJob] Executando... Verificando lembretes para antes de ${now.toISOString()}`
  );

  try {
    const dueReminders = await Reminder.find({
      date: { $lte: now },
      userPhoneNumber: { $exists: true, $ne: null },
    });

    if (dueReminders.length === 0) {
      devLog("[ReminderJob] Nenhum lembrete para enviar.");
      return;
    }

    devLog(
      `[ReminderJob] Encontrou ${dueReminders.length} lembrete(s) para enviar.`
    );

    for (const reminder of dueReminders) {
      try {
        const recipient = formatPhoneNumber(reminder.userPhoneNumber);

        if (!recipient) {
          devLog(
            `[ReminderJob] Lembrete #${reminder.messageId} tem número inválido. Pulando.`
          );
          continue;
        }

        const templateSid = process.env.TWILIO_REMINDER_TEMPLATE_SID;

        const templateVariables = {
          1: reminder.description,
        };

        devLog("[ReminderJob] MODO PRODUÇÃO: Enviando template real.");
        await sendTemplateMessage(recipient, templateSid, templateVariables);
        
        devLog(
          `[ReminderJob] Lembrete #${reminder.messageId} enviado via template para ${recipient}.`
        );

        await Reminder.findByIdAndDelete(reminder._id);
        devLog(`[ReminderJob] Lembrete #${reminder.messageId} excluído.`);
      } catch (sendError) {
        devLog(
          `[ReminderJob] Falha ao enviar ou excluir lembrete #${reminder.messageId}. Erro:`,
          sendError
        );
      }
    }
  } catch (error) {
    devLog("[ReminderJob] Erro geral ao processar lembretes:", error);
  }
}

//Roda a cada minuto ('* * * * *')
export function startReminderJob() {
  devLog("[Scheduler] Job de lembretes iniciado. Verificando a cada minuto.");
  cron.schedule("* * * * *", () => {
    checkAndSendReminders();
  });
}
