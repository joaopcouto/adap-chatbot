import cron from "node-cron";
import UserActivity from "../models/UserActivity.js";
import CloudApiService from "../services/cloudApiService.js";
import { syncUserActivityToSheet } from '../services/googleSheetsService.js';
import { devLog } from "../helpers/logger.js";
import dotenv from 'dotenv';

dotenv.config();

async function findAndNotifyInactiveUsers() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  try {
    const inactiveUsers = await UserActivity.find({ lastInteractionAt: { $lte: sevenDaysAgo } });
    if (inactiveUsers.length === 0) return;

    const cloudApiService = new CloudApiService();
    for (const user of inactiveUsers) {
      const firstName = user.name.split(' ')[0];
      const message = `Olá ${firstName}! 👋 Sentimos sua falta! Que tal voltar a organizar suas finanças com a ADAP? Estamos aqui para ajudar! 💰`;
      await cloudApiService.sendTextMessage(user.phoneNumber, message);
      devLog(`[InactiveUserJob] Mensagem de reativação enviada para ${user.name} (${user.phoneNumber}).`);
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
  cron.schedule('0 6 * * *', dailyTasks, { scheduled: true, timezone: "America/Sao_Paulo" });
  devLog("✅ Job de tarefas diárias (inatividade e sheets) agendado.");
}