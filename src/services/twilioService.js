import twilio from "twilio";
import { formatPhoneNumber } from "../utils/formatPhone.js";
import { fixPhoneNumber } from "../utils/phoneUtils.js";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
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
  return new Promise((resolve) => setTimeout(resolve, 100));
}

export async function sendProactiveMessage(to, body) {
  try {
    // 1. Limpa e formata o número base (garante que temos só os dígitos)
    let baseNumber = to.replace(/\D/g, ""); // Remove tudo que não for dígito

    // Garante que o número começa com 55 se for um número brasileiro
    if (baseNumber.length === 11 && !baseNumber.startsWith("55")) {
      baseNumber = "55" + baseNumber;
    }

    // 2. Monta o número final no formato E.164 para WhatsApp
    const e164Number = `whatsapp:+${baseNumber}`;

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: e164Number, // Usa o número formatado aqui
      body: body,
    });

    // Use devLog aqui se tiver importado
    console.log(`Mensagem proativa enviada para ${e164Number}`);
  } catch (error) {
    console.error(`Erro ao enviar mensagem proativa para ${to}:`, error);
    // Propague o erro para que o chamador saiba que falhou
    throw error;
  }
}
