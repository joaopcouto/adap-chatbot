import cron from "node-cron";
import Transaction from "../models/Transaction.js";
import { devLog } from "../helpers/logger.js";
import CloudApiService from "../services/cloudApiService.js";
import dotenv from 'dotenv';

dotenv.config();

const processInstallmentReminders = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  devLog(
    `[CRON JOB] Verificando lembretes de parcelas para ${today.toISOString().split("T")[0]}`
  );

  try {
    const upcomingInstallments = await Transaction.find({
      status: "pending", 
      type: "expense",
      date: { $gte: today, $lt: tomorrow },
    }).populate({
      path: "userId",
      model: "User",
      select: "phoneNumber", 
    });

    if (!upcomingInstallments || upcomingInstallments.length === 0) {
      devLog("[CRON JOB] Nenhuma parcela vencendo hoje para lembrar.");
      return;
    }

    devLog(
      `[CRON JOB] Encontradas ${upcomingInstallments.length} parcelas para lembrar.`
    );

    
    
    

    for (const transaction of upcomingInstallments) {
      if (transaction.userId && transaction.userId.phoneNumber) {
        try {
          const cloudApiService = new CloudApiService();
          const message = `💳 *Lembrete de Parcela*\n\n📝 ${transaction.description}\n💰 Valor: R$ ${transaction.amount.toFixed(2).replace(".", ",")}\n\n⏰ Vence hoje! Não esqueça de efetuar o pagamento.`;
          
          await cloudApiService.sendTextMessage(transaction.userId.phoneNumber, message);

          devLog(
            `Lembrete de parcela enviado com sucesso para ${transaction.userId.phoneNumber} sobre "${transaction.description}"`
          );

          await Transaction.updateOne(
            { _id: transaction._id },
            { $set: { status: "completed" } }
          );

          devLog(
            `Status da transação ${transaction._id} atualizado para 'completed'.`
          );

        } catch (sendError) {
          devLog(
            `[CRON JOB] Falha ao ENVIAR lembrete para ${transaction.userId.phoneNumber}. Erro: ${sendError.message}`
          );
        }
      } else {
        devLog.warn(
          `[CRON JOB] Ignorando transação ${transaction._id} por falta de dados de usuário ou telefone.`
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
  cron.schedule("* * * * *", processInstallmentReminders, {
    scheduled: true,
    timezone: "America/Sao_Paulo",
  });
  devLog("✅ Job de lembrete de parcelas agendado com sucesso.");
};
