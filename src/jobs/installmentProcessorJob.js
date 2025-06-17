
import cron from "node-cron";
import InstallmentPurchase from "../models/InstallmentPurchase.js";
import Expense from "../models/Expense.js";
import UserStats from "../models/UserStats.js";
import { devLog } from "../helpers/logger.js";
import { customAlphabet } from "nanoid";
import { formatInstallmentNotificationMessage } from '../helpers/messages.js';
import { sendProactiveMessage } from '../services/twilioService.js';

const generateId = customAlphabet("1234567890abcdef", 5);

const processInstallments = async () => {
  const today = new Date();
  const currentDay = today.getDate(); 
  
  devLog(`[CRON JOB] Verificando parcelas com vencimento no dia ${currentDay}...`);

  try {
    const duePurchases = await InstallmentPurchase.find({
      status: "active",
      dueDay: currentDay,
    });

    if (duePurchases.length === 0) {
      devLog("[CRON JOB] Nenhuma parcela com vencimento hoje encontrada.");
      return;
    }

    devLog(`[CRON JOB] Encontradas ${duePurchases.length} compras para processar parcelas.`);

    for (const purchase of duePurchases) {
      try { 
        const lastPaymentMonth = purchase.startDate.getMonth();
        const monthsPassed = (today.getFullYear() - purchase.startDate.getFullYear()) * 12 + (today.getMonth() - lastPaymentMonth);

        if (monthsPassed < purchase.currentInstallment) {
            devLog(`[CRON JOB] Parcela de "${purchase.description}" para o mês atual já foi processada. Pulando.`);
            continue;
        }

        const nextInstallmentNumber = purchase.currentInstallment + 1;
        
        const newExpense = new Expense({
          userId: purchase.userId,
          amount: purchase.installmentAmount,
          description: `${purchase.description} (${nextInstallmentNumber}/${purchase.numberOfInstallments})`,
          category: purchase.category,
          date: new Date(),
          messageId: generateId(),
          installmentParentId: purchase.originalMessageId,
        });
        await newExpense.save();

        await UserStats.findOneAndUpdate(
          { userId: purchase.userId },
          { $inc: { totalSpent: purchase.installmentAmount } },
          { upsert: true }
        );

        try {
          const notificationMessage = formatInstallmentNotificationMessage(newExpense);
          await sendProactiveMessage(purchase.userId, notificationMessage);
        } catch (notificationError) {
          devLog(`[CRON JOB] Despesa registrada, mas falha ao enviar notificação para ${purchase.userId}:`, notificationError);
        }

        purchase.currentInstallment = nextInstallmentNumber;
        
        if (nextInstallmentNumber >= purchase.numberOfInstallments) {
          purchase.status = "completed";
        }

        await purchase.save();
        devLog(`[CRON JOB] Parcela ${nextInstallmentNumber} de "${purchase.description}" processada com sucesso para o usuário ${purchase.userId}.`);

      } catch (individualError) {
        devLog(`[CRON JOB] Erro ao processar a parcela da compra ${purchase._id}. Pulando para a próxima. Erro:`, individualError);
      }
    }
  } catch (error) {
    devLog(`[CRON JOB] Erro grave ao buscar parcelas pendentes:`, error);
  }
};

export const startInstallmentJob = () => {
  cron.schedule("15 0 * * *", processInstallments, {
    scheduled: true,
    timezone: "America/Sao_Paulo",
  });
  devLog("✅ Job de processamento de parcelas agendado com sucesso.");
};