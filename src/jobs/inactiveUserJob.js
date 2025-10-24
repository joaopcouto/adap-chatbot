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
    for (const user of inactiveUsers) {
      await sendTemplateMessage(`whatsapp:${user.phoneNumber}`, templateSid, { '1': user.name.split(' ')[0] });
    }
  } catch (error) { devLog("Erro no job de inatividade:", error); }
}

async function dailyTasks() {
  devLog("[DailyTasks] Iniciando tarefas diárias...");
  await findAndNotifyInactiveUsers();
  await syncUserActivityToSheet();
  devLog("[DailyTasks] Tarefas diárias concluídas.");
}

export function startInactiveUserJob() {
  cron.schedule('53 11 * * *', dailyTasks, { scheduled: true, timezone: "America/Sao_Paulo" });
  devLog("✅ Job de tarefas diárias (inatividade e sheets) agendado.");
}