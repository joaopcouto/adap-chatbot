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
      to: formattedNumber,
      mediaUrl: [imageUrl],
      body: "📊 Relatório de gastos",
    });

    console.log(`✅ Mensagem enviada: ${message.sid}`);
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error);
  }
}

export const sendTemplateMessage = async (to, contentSid, variables) => {
    if (!client) {
        devLog('Tentativa de enviar mensagem com o cliente Twilio não inicializado.');
        throw new Error('Twilio client is not initialized.');
    }
    
    try {
        
        const message = await client.messages.create({
            contentSid: contentSid,
            from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
            contentVariables: JSON.stringify(variables),
            to: to
        });

        devLog(`Template ${contentSid} enviado para ${to} com sucesso. SID: ${message.sid}`);
        return message;
    } catch (error) {
        devLog(`Erro ao enviar mensagem de template via serviço: ${error}`);
        throw error; 
    }
};

export const sendTextMessage = async (to, body) => {
    if (!client) {
        devLog('Tentativa de enviar mensagem com o cliente Twilio não inicializado.');
        throw new Error('Twilio client is not initialized.');
    }

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
};


//funções para o ambiente de testes
export async function sendTextMessageTEST(to, body) {
  console.log("--- MENSAGEM DE TESTE ---");
  console.log(`DESTINO: ${to}`);
  console.log(`CONTEÚDO:\n${body}`);
  console.log("---------------------------\n");
  return new Promise((resolve) => setTimeout(resolve, 100));
}
export async function sendTemplateMessageTEST(recipient, templateSid, variables) {
  console.log("\n=================================================");
  console.log("======= 🚀 SIMULAÇÃO DE ENVIO DE TEMPLATE 🚀 =======");
  console.log("=================================================");
  console.log(`|-> 📲 Destinatário: ${recipient}`);
  console.log(`|-> 📄 Template SID: ${templateSid}`);
  console.log(`|-> 📦 Variáveis:`);
  console.log(JSON.stringify(variables, null, 2)); 
  console.log("=================================================\n");

  return Promise.resolve();
}
//funções para o ambiente de testes