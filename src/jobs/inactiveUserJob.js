import cron from "node-cron";
import UserActivity from "../models/UserActivity.js";
import { sendTemplateMessage } from "../services/twilioService.js";
import { syncUserActivityToSheet } from '../services/googleSheetsService.js';
import { devLog } from "../helpers/logger.js";
import dotenv from 'dotenv';

dotenv.config();

async function findAndNotifyInactiveUsers() {
  devLog("[InactiveUserJob] Iniciando verificação de usuários inativos...");

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(23, 59, 59, 999);

  try {
    const inactiveUsers = await UserActivity.find({
      lastInteractionAt: { $lte: sevenDaysAgo },
    });
    
    if (inactiveUsers.length === 0) {
      devLog("[InactiveUserJob] Nenhum usuário inativo encontrado para notificar hoje.");
      return;
    }

    const templateSid = process.env.TWILIO_INACTIVE_USER_TEMPLATE_SID;
    if (!templateSid) {
      devLog("[InactiveUserJob] ERRO: TWILIO_INACTIVE_USER_TEMPLATE_SID não está definido no .env");
      return;
    }

    devLog(`[InactiveUserJob] Encontrados ${inactiveUsers.length} usuários inativos. Enviando lembretes...`);

    for (const user of inactiveUsers) {
      try {
        const firstName = user.name.split(' ')[0];

        const contentVariables = {
          '1': firstName
        };

        //await sendTemplateMessage(`whatsapp:${user.phoneNumber}`, templateSid, contentVariables);

        //devLog(`[InactiveUserJob] Lembrete de inatividade enviado para ${user.name} (${user.phoneNumber}).`);

      } catch (sendError) {
        devLog(`[InactiveUserJob] Falha ao ENVIAR lembrete para ${user.name}. Erro: ${sendError.message}`);
      }
    }
  } catch (error) { 
    devLog("[InactiveUserJob] Erro GERAL ao processar usuários inativos:", error);
  }
}

async function dailyTasks() {
  devLog("[DailyTasks] Iniciando tarefas diárias...");
  await findAndNotifyInactiveUsers();
  await syncUserActivityToSheet();
  devLog("[DailyTasks] Tarefas diárias concluídas.");
}

export function startInactiveUserJob() {
  cron.schedule('39 11 * * *', dailyTasks, { 
    scheduled: true, 
    timezone: "America/Sao_Paulo" 
  });
  devLog("✅ Job de tarefas diárias (inatividade e sheets) agendado.");
}