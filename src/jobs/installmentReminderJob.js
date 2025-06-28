import cron from "node-cron";
import mongoose from "mongoose"; // Importando mongoose para usar o ObjectId
import Transaction from "../models/Transaction.js";
import { devLog } from "../helpers/logger.js";
import { sendProactiveMessage } from "../services/twilioService.js";
import { formatInstallmentReminderMessage } from "../helpers/messages.js";

/**
 * Busca e processa lembretes de parcelas que vencem na data atual.
 */
const processInstallmentReminders = async () => {
  // 1. Prepara as datas para a consulta
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Início do dia de hoje

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1); // Início do dia de amanhã

  devLog(`[CRON JOB] Verificando lembretes de parcelas para ${today.toISOString().split("T")[0]}`);

  try {
    // 2. Executa a busca na coleção de transações
    const upcomingInstallments = await Transaction.find({
      status: "pending",
      type: "expense", // Boa prática: garantir que são apenas despesas
      date: { $gte: today, $lt: tomorrow },
    }).populate({
        path: 'userId',   // O campo que queremos popular
        model: 'User',    // O nome EXATO do modelo (string), como definido em User.js
        select: 'name phoneNumber' // Opcional, mas eficiente: seleciona apenas os campos que precisamos
    });

    // 3. Verifica se há parcelas
    if (!upcomingInstallments || upcomingInstallments.length === 0) {
      devLog("[CRON JOB] Nenhuma parcela vencendo hoje para lembrar.");
      return;
    }

    devLog(`[CRON JOB] Encontradas ${upcomingInstallments.length} parcelas para lembrar.`);

    // 4. Itera sobre cada parcela e envia a mensagem
    for (const transaction of upcomingInstallments) {
      // 5. Verificação de segurança tripla
      // a) transaction.userId não é null (populate funcionou)
      // b) transaction.userId é um objeto (temos os dados do usuário)
      // c) transaction.userId.phoneNumber existe e não está vazio
      if (transaction.userId && typeof transaction.userId === 'object' && transaction.userId.phoneNumber) {
        try {
          // Formata a mensagem de lembrete
          const reminderMessage = formatInstallmentReminderMessage(transaction);
          
          // Envia a mensagem proativa para o número de telefone correto
          await sendProactiveMessage(transaction.userId.phoneNumber, reminderMessage);
          
          devLog(`Lembrete enviado com sucesso para ${transaction.userId.phoneNumber} sobre "${transaction.description}"`);
        
        } catch (sendError) {
          devLog(`[CRON JOB] Falha ao ENVIAR lembrete para ${transaction.userId.phoneNumber}. Erro:`, sendError);
        }
      } else {
        // Log de diagnóstico para o caso do populate falhar silenciosamente
        devLog(`[CRON JOB] Ignorando transação ${transaction._id} por falta de dados de usuário ou telefone. User data:`, transaction.userId);
      }
    }
  } catch (error) {
    devLog(`[CRON JOB] Erro GERAL ao buscar/processar lembretes de parcelas:`, error);
  }
};

/**
 * Agenda a execução do job de lembretes de parcelas.
 */
export const startInstallmentReminderJob = () => {
  // Executa todo dia às 9:00 da manhã no fuso horário de São Paulo
  // Para testes (a cada minuto): '* * * * *'
  cron.schedule("0 9 * * *", processInstallmentReminders, {
    scheduled: true,
    timezone: "America/Sao_Paulo",
  });
  devLog("✅ Job de lembrete de parcelas agendado com sucesso.");
};