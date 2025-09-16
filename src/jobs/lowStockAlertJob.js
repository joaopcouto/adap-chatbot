import cron from "node-cron";
import Product from "../models/Product.js";
import User from "../models/User.js"; 
import { sendTemplateMessage } from "../services/twilioService.js";
import { devLog } from "../helpers/logger.js";
import dotenv from 'dotenv';

dotenv.config();

async function checkLowStock() {
  devLog("[LowStockJob] Verificando produtos com estoque baixo...");

  try {
    const lowStockProducts = await Product.find({
      $expr: { $lte: ["$quantity", "$minStockLevel"] }
    }).populate({ 
      path: 'userId',
      model: User,
      select: 'phoneNumber name' 
    });

    if (lowStockProducts.length === 0) {
      devLog("[LowStockJob] Nenhum produto com estoque baixo encontrado.");
      return;
    }

    const templateSid = process.env.TWILIO_LOW_STOCK_TEMPLATE_SID;
    if (!templateSid) {
      devLog("[LowStockJob] A variável TWILIO_LOW_STOCK_TEMPLATE_SID não está definida no .env");
      return;
    }

    for (const product of lowStockProducts) {
      if (product.userId && product.userId.phoneNumber) {
        const description = Object.values(Object.fromEntries(product.attributes)).join(' ');
        await sendTemplateMessage(`whatsapp:${product.userId.phoneNumber}`, templateSid, {
          '1': description,
          '2': product.quantity.toString()
        });
        devLog(`Alerta de estoque baixo enviado para ${product.userId.name} sobre o produto ${description}`);
      }
    }
  } catch (error) {
    devLog("[LowStockJob] Erro ao verificar estoque baixo:", error);
  }
}

export function startLowStockAlertJob() {
  cron.schedule('0 9 * * *', checkLowStock, { timezone: "America/Sao_Paulo" });
  devLog("✅ Job de alerta de estoque baixo agendado com sucesso.");
}