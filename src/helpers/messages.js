import { OpenAI } from "openai";
import { formatInBrazil } from "../utils/dateUtils.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export function sendGreetingMessage(twiml) {
  twiml.message(`👋 Olá! Sou a ADAP, sua Assistente Financeira Pessoal. Confira nossa lista de comandos:

*1. LANÇAMENTOS MANUAIS* 📝
 • *25 mercado*
 • *recebi 2000 salário*
 • *3500 celular em 10x*

*2. REGISTRO POR FOTO* 📸
 • _Nota Fiscal de Loja_
 • _Conta de Consumo (água, luz, etc.)_
 • _Comprovante de PIX_

*3. RELATÓRIOS E CONSULTAS* 📊
 • *ver categorias*: ver, excluir e definir limites mensais para categorias
 • *saldo*: Mostra o saldo do mês atual
 • *gasto total* ou *receita total*:
  - Para o mês atual: *gasto total*
  - Para um intervalo: *receita de 01/10 até hoje*
  - Para um único dia: *gastos do dia 20/09*, *gastos de ontem*
 • _Gráfico de Barras:_ *quais meus gastos nos últimos 7 dias*
 • _Gráfico de Pizza (Gastos):_ *onde gastei nos últimos 15 dias*
 • _Gráfico de Pizza (Receitas):_ *gráfico dos meus ganhos*

 *4. ORGANIZAÇÃO* ⏰
 • *me lembre de pagar o aluguel dia 5*
 • *quais são meus lembretes*
 • *parcelamentos ativos*

*5. CONTROLE DE ESTOQUE (💎 PLANO DIAMANTE)* 📦
 • _Criar um Estoque:_ *criar estoque de camisetas*
 • _Adicionar Produto:_ *adicionar camiseta*
 • _Ver Produtos:_ *ver estoque de camisetas*
 • _Movimentar Estoque:_ *vendi 2 #P0001* ou *entrada 10 #P0002*
 • _Definir Alerta:_ *alerta #P0001 para 5 unidades*

*6. EXCLUIR REGISTROS* 🗑️
Use sempre o ID (#...) fornecido na mensagem de confirmação.
 • *remover gasto #a4b8c*
 • *excluir parcelamento #J-9tpH*
 • *apagar lembrete #d9bdd3*

Estou aqui para simplificar seu controle financeiro. Vamos começar?`);
}

export function sendHelpMessage(twiml) {
  sendGreetingMessage(twiml);
}

export function sendIncomeAddedMessage(twiml, incomeData) {
  const formattedDate = formatInBrazil(incomeData.date); //formato brasil

  twiml.message(
    `📝 *Receita adicionada*\n📌 ${incomeData.description.toUpperCase()} (_${
      incomeData.category.charAt(0).toUpperCase() + incomeData.category.slice(1)
    }_)\n💰 *R$ ${incomeData.amount.toFixed(2)}*\n\n📅 ${formattedDate} - #${
      incomeData.messageId
    }`
  );
}

export function sendExpenseAddedMessage(twiml, expenseData) {
  const formattedDate = formatInBrazil(expenseData.date);

  twiml.message(
    `📝 *Gasto adicionado*\n📌 ${expenseData.description.toUpperCase()} (_${
      expenseData.category.charAt(0).toUpperCase() +
      expenseData.category.slice(1)
    }_)\n💰 *R$ ${expenseData.amount.toFixed(2)}*\n\n📅 ${formattedDate} - #${
      expenseData.messageId
    }`
  );
}

export function sendIncomeDeletedMessage(twiml, incomeData) {
  twiml.message(`🗑️ Receita #_${incomeData.messageId}_ removida.`);
}

export function sendExpenseDeletedMessage(twiml, expenseData) {
  twiml.message(`🗑️ Gasto #_${expenseData.messageId}_ removido.`);
}

export function sendTotalIncomeMessage(twiml, total, monthName) {
  let message = `*Receita total*: R$ ${total.toFixed(2)}`;
  if (monthName) {
    message = `*Receita total* em _*${monthName}*_: \nR$ ${total.toFixed(2)}`;
  }

  // Add option to see details if there are incomes
  if (total > 0) {
    message += `\n\n💡 Digite *"detalhes"* para ver a lista completa das receitas.`;
  }

  twiml.message(message);
}

export function sendTotalExpenseMessage(twiml, total, monthName, categoryName) {
  let message = `*Gasto total*: R$ ${total.toFixed(2)}`;
  if (monthName && categoryName) {
    message = `*Gasto total* com _*${categoryName}*_ em _*${monthName}*_: \nR$ ${total.toFixed(
      2
    )}`;
  } else if (monthName) {
    message = `*Gasto total* em _*${monthName}*_: \nR$ ${total.toFixed(2)}`;
  } else if (categoryName) {
    message = `*Gasto total* com _*${categoryName}*_: \nR$ ${total.toFixed(2)}`;
  }

  // Add option to see details if there are expenses
  if (total > 0) {
    message += `\n\n💡 Digite *"detalhes"* para ver a lista completa dos gastos.`;
  }

  twiml.message(message);
}

export function sendTotalRemindersMessage(twiml, allFutureReminders) {
  twiml.message(
    `Aqui estão seus próximos compromissos:\n\n${allFutureReminders}\n\n Para apagar um lembrete, basta digitar "Apagar lembrete #codigo-do-lembrete"  \n\nSe quiser mais detalhes ou adicionar novos lembretes, é só me chamar! 😊`
  );
}

export async function sendReminderMessage(twiml, message, reminderData) {
  const prompt = `Based on the provided information, write a short, friendly, and natural sentence in Brazilian Portuguese as if you are confirming or acknowledging the task or event, using a tone similar to: "Marquei aqui sua aula pro dia 14 de maio" or "Anotei seu compromisso para o dia tal".
  Only return the final sentence, no extra explanations.
  Use this message to retrieve the data:
  data: ${message} include this at the end: #${reminderData.messageId}`;
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
  });

  const content = response.choices[0].message.content;

  if (twiml) { 
    twiml.message(content);
  } else { 
    return content;
  }
}

export function sendReminderDeletedMessage(twiml, reminderData) {
  twiml.message(`🗑️ Lembrete #_${reminderData.messageId}_ removido.`);
}

export async function sendFinancialHelpMessage(twiml, message) {
  const prompt = `You are a financial assistant who specializes in helping users with questions about investments, personal finance and planning. Please answer the following question clearly and helpfully, in Brazilian Portuguese:

  "${message}"`;

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
  });

  twiml.message(response.choices[0].message.content);
}

/**
 * Audio Processing Messages
 */

export function sendAudioProcessingMessage(twiml) {
  twiml.message("🎤 Processando seu áudio... Só um instante.");
}

export function sendAudioTranscriptionSuccessMessage(twiml, transcription) {
  twiml.message(`🎤✅ Áudio processado: "${transcription}"`);
}

// Audio Error Messages
export const AUDIO_ERROR_MESSAGES = {
  DOWNLOAD_FAILED: "❌ Não consegui baixar seu áudio. Tente enviar novamente.",
  FILE_TOO_LARGE: "📏 Seu áudio é muito grande. Envie um áudio de até 16MB.",
  UNSUPPORTED_FORMAT: "📱 Formato de áudio não suportado. Use MP3, WAV ou OGG.",
  TRANSCRIPTION_FAILED: "🎤❌ Não consegui entender seu áudio. Tente falar mais claramente ou envie uma mensagem de texto.",
  TRANSCRIPTION_EMPTY: "🔇 Seu áudio está muito baixo ou sem fala. Tente gravar novamente.",
  SERVICE_UNAVAILABLE: "⚠️ Serviço de áudio temporariamente indisponível. Tente novamente em alguns minutos.",
  PROCESSING_TIMEOUT: "⏱️ Processamento do áudio demorou muito. Tente com um áudio mais curto.",
  NETWORK_ERROR: "🌐 Erro de conexão ao processar áudio. Tente novamente.",
  VALIDATION_FAILED: "❌ Erro ao validar arquivo de áudio. Tente novamente.",
  TRANSCRIPTION_TOO_SHORT: "🎤 Não consegui entender seu áudio. Tente falar mais claramente.",
  INTERNAL_ERROR: "⚙️ Erro interno ao processar áudio. Tente novamente ou envie uma mensagem de texto.",
  UNKNOWN_ERROR: "❓ Erro inesperado ao processar áudio. Tente novamente ou envie uma mensagem de texto."
};

export function sendAudioErrorMessage(twiml, errorType) {
  const message = AUDIO_ERROR_MESSAGES[errorType] || AUDIO_ERROR_MESSAGES.UNKNOWN_ERROR;
  twiml.message(message);
}

export function getAudioErrorMessage(errorType) {
  return AUDIO_ERROR_MESSAGES[errorType] || AUDIO_ERROR_MESSAGES.UNKNOWN_ERROR;
}
