import cron from "node-cron";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import { devLog } from "../helpers/logger.js";
import { sendProactiveMessage } from "../services/twilioService.js";
import { formatInstallmentReminderMessage } from "../helpers/messages.js";

const processInstallmentReminders = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  devLog(
    `[CRON JOB] Verificando lembretes de parcelas para ${
      today.toISOString().split("T")[0]
    }`
  );

  try {
    const upcomingInstallments = await Transaction.find({
      status: "pending",
      type: "expense",
      date: { $gte: today, $lt: tomorrow },
    }).populate({
      path: "userId",
      model: "User",
      select: "name phoneNumber",
    });

    if (!upcomingInstallments || upcomingInstallments.length === 0) {
      devLog("[CRON JOB] Nenhuma parcela vencendo hoje para lembrar.");
      return;
    }

    devLog(
      `[CRON JOB] Encontradas ${upcomingInstallments.length} parcelas para lembrar.`
    );

    for (const transaction of upcomingInstallments) {
      if (
        transaction.userId &&
        typeof transaction.userId === "object" &&
        transaction.userId.phoneNumber
      ) {
        try {
          const reminderMessage = formatInstallmentReminderMessage(transaction);
          await sendProactiveMessage(
            transaction.userId.phoneNumber,
            reminderMessage
          );
          devLog(
            `Lembrete enviado com sucesso para ${transaction.userId.phoneNumber} sobre "${transaction.description}"`
          );
          // --- NOVO: ATUALIZA O STATUS DA PARCELA ---
          await Transaction.updateOne(
            { _id: transaction._id },
            { $set: { status: "completed" } }
          );
          devLog(
            `Status da transação ${transaction._id} atualizado para 'completed'.`
          );
          // ------------------------------------------
        } catch (sendError) {
          devLog(
            `[CRON JOB] Falha ao ENVIAR lembrete para ${transaction.userId.phoneNumber}. Erro:`,
            sendError
          );
        }
      } else {
        devLog(
          `[CRON JOB] Ignorando transação ${transaction._id} por falta de dados de usuário ou telefone. User data:`,
          transaction.userId
        );
      }
    }
  } catch (error) {
    devLog(
      `[CRON JOB] Erro GERAL ao buscar/processar lembretes de parcelas:`,
      error
    );
  }
};

export const startInstallmentReminderJob = () => {
  // Executa todo dia às 9:00 da manhã ('0 9 * * *')no fuso horário de São Paulo
  // Para testes (a cada minuto): '* * * * *'
  cron.schedule("0 9 * * *", processInstallmentReminders, {
    scheduled: true,
    timezone: "America/Sao_Paulo",
  });
  devLog("✅ Job de lembrete de parcelas agendado com sucesso.");
};
