import twilio from "twilio";
import { formatPhoneNumber } from "../utils/formatPhone.js";
import { devLog } from "../helpers/logger.js";
import dotenv from 'dotenv';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

if (!client) {
    devLog('Credenciais do Twilio não encontradas. Verifique seu arquivo .env');
}

export async function sendReportImage(userId, imageUrl) {
  const formattedNumber = formatPhoneNumber(userId);
  try {
    const message = await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: userId,
      mediaUrl: [imageUrl],
      body: "📊 Relatório de gastos",
    });

    console.log(`✅ Mensagem enviada: ${message.sid}`);
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error);
  }
}

// Função para simular o envio de mensagem de texto no terminal
async function logTextMessage(to, body) {
  console.log("\n---  simulated TWILIO TEXT message ---");
  console.log(`  TO: ${to}`);
  console.log(`  BODY: \n${body}`);
  console.log("-------------------------------------\n");
  return Promise.resolve({ sid: `SIMULATED_${Date.now()}` });
}

// Função para simular o envio de template no terminal
async function logTemplateMessage(to, contentSid, variables) {
  console.log("\n--- simulated TWILIO TEMPLATE message ---");
  console.log(`  TO: ${to}`);
  console.log(`  TEMPLATE_SID: ${contentSid}`);
  console.log('  VARIABLES:', JSON.stringify(variables, null, 2));
  console.log("-----------------------------------------\n");
  return Promise.resolve({ sid: `SIMULATED_${Date.now()}` });
}

export async function sendTextMessage(to, body) {
  // Se a variável de ambiente NODE_ENV NÃO for 'prod', simula a mensagem
  if (process.env.NODE_ENV !== 'prod') {
    return logTextMessage(to, body);
  }

  // Se for 'prod', envia a mensagem de verdade
  try {
    const message = await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      body: body,
      to: to
    });
    devLog(`Mensagem de texto enviada para ${to}. SID: ${message.sid}`);
    return message;
  } catch (error) {
    devLog(`Erro ao enviar mensagem de texto: ${error}`);
    throw error;
  }
}

export const sendTemplateMessage = async (to, contentSid, variables) => {
  // Se a variável de ambiente NODE_ENV NÃO for 'prod', simula a mensagem
  if (process.env.NODE_ENV !== 'prod') {
    return logTemplateMessage(to, contentSid, variables);
  }
  
  // Se for 'prod', envia o template de verdade
  try {
    const message = await client.messages.create({
      contentSid: contentSid,
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      contentVariables: JSON.stringify(variables),
      to: to
    });
    devLog(`Template ${contentSid} enviado para ${to}. SID: ${message.sid}`);
    return message;
  } catch (error) {
    devLog(`Erro ao enviar mensagem de template via serviço: ${error}`);
    throw error; 
  }
};