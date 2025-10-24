import cron from "node-cron";
import UserActivity from "../models/UserActivity.js";
import { devLog } from "../helpers/logger.js";

async function resetMonthlyMessageCount() {
  try {
    devLog("[MonthlyResetJob] Iniciando o reset da contagem de mensagens mensais...");

    const result = await UserActivity.updateMany(
      {}, 
      { $set: { messageCount: 0 } } 
    );

    devLog(`[MonthlyResetJob] Reset concluído. ${result.modifiedCount} usuários tiveram sua contagem de mensagens zerada.`);

  } catch (error) {
    devLog("[MonthlyResetJob] Erro ao resetar a contagem de mensagens:", error);
  }
}

export function startMonthlyResetJob() {
  // '5 0 1 * *' = "Às 00:05 do dia 1 de cada mês."
  cron.schedule('5 0 1 * *', resetMonthlyMessageCount, {
    scheduled: true,
    timezone: "America/Sao_Paulo",
  });
  devLog("✅ Job de reset mensal da contagem de mensagens agendado com sucesso.");
}