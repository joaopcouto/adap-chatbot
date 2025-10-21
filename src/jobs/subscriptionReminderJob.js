import cron from 'node-cron';
import Permissions from '../models/Permissions.js';
import User from '../models/User.js'; 
import { sendTemplateMessage } from '../services/twilioService.js';
import { devLog } from '../helpers/logger.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkAndSendSubscriptionReminders() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0); 

  const dayAfterTomorrow = new Date(tomorrow);
  dayAfterTomorrow.setDate(tomorrow.getDate() + 1); 

  devLog(`[SubscriptionJob] Verificando assinaturas que expiram entre ${tomorrow.toISOString()} e ${dayAfterTomorrow.toISOString()}`);

  try {
    const expiringPermissions = await Permissions.find({
      productId: 'chatbot',
      access: true,
      expiresAt: {
        $gte: tomorrow,
        $lt: dayAfterTomorrow,
      },
    }).populate({ 
      path: 'userId',
      model: 'User',
      select: 'name phoneNumber' 
    });

    if (expiringPermissions.length === 0) {
      devLog('[SubscriptionJob] Nenhuma assinatura expirando amanhã.');
      return;
    }

    devLog(`[SubscriptionJob] Encontradas ${expiringPermissions.length} assinaturas para lembrar.`);

    const templateSid = process.env.TWILIO_EXPIRATION_TEMPLATE_SID;

    for (const permission of expiringPermissions) {
      if (permission.userId && permission.userId.phoneNumber) {
        const user = permission.userId;
        
        await sendTemplateMessage(
          user.phoneNumber,
          templateSid,
          {
            '1': user.name.split(' ')[0], 
          }
        );

        devLog(`[SubscriptionJob] Lembrete de expiração enviado para ${user.name} (${user.phoneNumber}).`);
      }
    }
  } catch (error) {
    devLog('[SubscriptionJob] Erro ao processar lembretes de expiração:', error);
  }
}

export function startSubscriptionReminderJob() {
  // Agenda para rodar todo dia às 8:00 da manhã, no fuso de São Paulo.
  cron.schedule('0 8 * * *', checkAndSendSubscriptionReminders, {
    scheduled: true,
    timezone: "America/Sao_Paulo",
  });
  devLog('✅ Job de lembrete de expiração de assinatura agendado.');
}