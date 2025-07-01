import cron from "node-cron";
import Transaction from "../models/Transaction.js";
import { devLog } from "../helpers/logger.js";
import { sendTemplateMessage } from "../services/twilioService.js";
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

    // Pega o SID do template do .env
    const templateSid = process.env.TWILIO_INSTALLMENT_TEMPLATE_SID;
    if (!templateSid) {
      devLog(
        "[CRON JOB] ERRO CRÍTICO: TWILIO_INSTALLMENT_TEMPLATE_SID não definido no .env"
      );
      return; // Sai da função se o SID não estiver configurado
    }

    for (const transaction of upcomingInstallments) {
      if (
        transaction.userId &&
        typeof transaction.userId === "object" &&
        transaction.userId.phoneNumber
      ) {
        try {
          // Formata o número do destinatário
          const recipient = formatPhoneNumber(transaction.userId.phoneNumber);

          // Cria o objeto de variáveis para o template
          const templateVariables = {
            1: transaction.userId.name || "usuário", // Nome do usuário
            2: transaction.description, // Descrição da parcela
            3: transaction.amount.toFixed(2).replace(".", ","), // Valor formatado
          };

          // --- MUDA A CHAMADA DA FUNÇÃO ---
          // ANTES: await sendProactiveMessage(transaction.userId.phoneNumber, reminderMessage);
          // AGORA:
          await sendTemplateMessage(recipient, templateSid, templateVariables);

          devLog(
            `Lembrete de parcela enviado com sucesso para ${recipient} sobre "${transaction.description}"`
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
            `[CRON JOB] Falha ao ENVIAR lembrete de parcela para ${transaction.userId.phoneNumber}. Erro:`,
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
