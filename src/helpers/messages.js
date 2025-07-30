import { OpenAI } from "openai";
import { formatInBrazil } from "../utils/dateUtils.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export function sendGreetingMessage(twiml) {
  twiml.message(`👋 Olá! Sou a ADAP, sua Assistente Financeira Pessoal. Organize suas finanças de forma simples e direta, aqui mesmo no WhatsApp.

Aqui estão alguns exemplos para começar:

Lançamentos Diários 📝
› "25 mercado"
› "150 uber em transporte"
› "recebi 2000 salário"

Compras Parceladas 💳
› "3500 PS5 em 10x"
› "parcelamentos ativos"

Relatórios e Gráficos 📊
› "gasto total"
› "receita total em junho"
› "onde gastei nos últimos 30 dias"
› "quais meus gastos nos últimos 7 dias"

Lembretes ⏰
› "me lembre de pagar o aluguel dia 5"
› "quais são meus lembretes"

Para apagar algo, use o ID fornecido no registro. Por exemplo:
› "remover gasto #a4b8c"
› "excluir parcelamento #J-9tpH"
› "apagar lembrete #d9bdd3"

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
    }_)\n💰 *R$ ${incomeData.amount.toFixed(
      2
    )}*\n\n📅 ${formattedDate} - #${
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
    }_)\n💰 *R$ ${expenseData.amount.toFixed(
      2
    )}*\n\n📅 ${formattedDate} - #${
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

  twiml.message(response.choices[0].message.content);
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
