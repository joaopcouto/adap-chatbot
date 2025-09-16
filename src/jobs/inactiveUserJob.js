import cron from "node-cron";
import UserActivity from "../models/UserActivity.js";
import { sendTemplateMessage } from "../services/twilioService.js";
import { devLog } from "../helpers/logger.js";
import { syncUserActivityToSheet } from '../services/googleSheetsService.js';
import dotenv from 'dotenv';

dotenv.config();

async function findAndNotifyInactiveUsers() {
  devLog("[InactiveUserJob] Iniciando verificação de usuários inativos...");

  const today = new Date();
  const sevenDaysAgo = new Date(today); 
  sevenDaysAgo.setDate(today.getDate() - 7);

  try {
    const inactiveUsers = await UserActivity.find({
      lastInteractionAt: { $lte: sevenDaysAgo }, 
    });

    if (inactiveUsers.length === 0) {
      devLog("[InactiveUserJob] Nenhum usuário inativo encontrado.");
      return;
    }

    devLog(`[InactiveUserJob] Encontrados ${inactiveUsers.length} usuários inativos. Enviando lembretes...`);

    const templateSid = process.env.TWILIO_INACTIVE_USER_TEMPLATE_SID;

    for (const user of inactiveUsers) {
      try {
        await sendTemplateMessage(`whatsapp:${user.phoneNumber}`, templateSid, {
          '1': user.name.split(' ')[0], 
        });
        devLog(`Lembrete de inatividade enviado para ${user.name}`);
      } catch (error) {
        devLog(`Falha ao enviar lembrete para ${user.name}:`, error);
      }
    }
  } catch (error) {
    devLog("[InactiveUserJob] Erro ao processar usuários inativos:", error);
  }
}

async function dailyTasks() {
  await findAndNotifyInactiveUsers(); 
  await syncUserActivityToSheet();    
}

export function startInactiveUserJob() {
  // Executa todo dia às 9:00 da manhã no fuso horário de São Paulo
  cron.schedule('0 9 * * *', dailyTasks, {
    scheduled: true,
    timezone: "America/Sao_Paulo",
  });
  devLog("✅ Job de lembrete de inatividade agendado com sucesso.");
}