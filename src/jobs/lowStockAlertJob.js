import cron from "node-cron";
import Product from "../models/Product.js";
import User from "../models/User.js";
import { sendTemplateMessage } from "../services/twilioService.js";
import { devLog } from "../helpers/logger.js";
import dotenv from 'dotenv';

dotenv.config();

const processLowStockAlerts = async () => {
  devLog("[CRON JOB] Verificando produtos com estoque baixo...");

  try {
    const lowStockProducts = await Product.find({
      $expr: { $lte: ["$quantity", "$minStockLevel"] }
    });

    if (lowStockProducts.length === 0) {
      devLog("[CRON JOB] Nenhum produto com estoque baixo encontrado.");
      return;
    }

    devLog(`[CRON JOB] Encontrados ${lowStockProducts.length} produtos com estoque baixo para notificar.`);

    const templateSid = process.env.TWILIO_LOW_STOCK_TEMPLATE_SID;
    if (!templateSid) {
        devLog("[CRON JOB] ERRO: TWILIO_LOW_STOCK_TEMPLATE_SID não definido no .env");
        return;
    }

    for (const product of lowStockProducts) {
      try {
        const user = await User.findById(product.userId);
        if (user && user.phoneNumber) {
          const description = Object.values(Object.fromEntries(product.attributes)).join(' ');

          await sendTemplateMessage(
            `whatsapp:${user.phoneNumber}`,
            templateSid,
            {
              '1': description,       
              '2': product.quantity.toString() 
            }
          );

          devLog(`Alerta de estoque baixo para "${description}" enviado para ${user.phoneNumber}`);
        }
      } catch (sendError) {
        devLog(`[CRON JOB] Falha ao enviar alerta para produto ${product.customId}. Erro: ${sendError.message}`);
      }
    }
  } catch (error) {
    devLog("[CRON JOB] Erro GERAL ao processar alertas de estoque:", error);
  }
};

export const startLowStockAlertJob = () => {
  cron.schedule('0 9 * * *', processLowStockAlerts, {
    scheduled: true,
    timezone: "America/Sao_Paulo",
  });
  devLog("✅ Job de alerta de estoque baixo agendado com sucesso.");
};