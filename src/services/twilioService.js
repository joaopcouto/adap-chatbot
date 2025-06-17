import twilio from "twilio";
import { formatPhoneNumber } from "../utils/formatPhone.js";
import { devLog } from '../helpers/logger.js';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function sendReportImage(userId, imageUrl) {
  const formattedNumber = formatPhoneNumber(userId);

  try {
    const message = await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: formattedNumber,
      mediaUrl: [imageUrl],
      body: "📊 Relatório de gastos",
    });

    console.log(`✅ Mensagem enviada: ${message.sid}`);
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error);
  }
}

export async function sendProactiveMessage(to, body) {
  try {
    await client.messages.create({
      from: `whatsapp:${twilioPhone}`,
      to: to, 
      body: body, 
    });
    devLog(`Mensagem proativa enviada para ${to}`);
  } catch (error) {
    console.error(`Erro ao enviar mensagem proativa para ${to}:`, error);
  }
}