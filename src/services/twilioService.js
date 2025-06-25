import twilio from "twilio";
import { formatPhoneNumber } from "../utils/formatPhone.js";

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER; 

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

export async function sendTextMessage(to, body) {
  try {
    const message = await client.messages.create({
      body: body,
      from: `whatsapp:${twilioPhoneNumber}`,
      to: to, 
    });
    console.log(`✅ Mensagem de texto enviada: ${message.sid}`);
  } catch (error) {
    console.error("Erro ao enviar mensagem de texto via serviço:", error);
    throw error;
  }
}

//função para o ambiente de testes
export async function sendTextMessageTEST(to, body) {
  console.log("--- MENSAGEM DE TESTE ---");
  console.log(`DESTINO: ${to}`);
  console.log(`CONTEÚDO:\n${body}`);
  console.log("---------------------------\n");
  return new Promise(resolve => setTimeout(resolve, 100));
}