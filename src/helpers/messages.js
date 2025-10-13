import { OpenAI } from "openai";
import { formatInBrazil } from "../utils/dateUtils.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export function sendGreetingMessage(twiml) {
  twiml.message(`👋 Olá! Sou a ADAP, sua Assistente Financeira Pessoal. Confira nossa lista de comandos:

*1. LANÇAMENTOS MANUAIS* 📝
 • "25 mercado"
 • "recebi 2000 salário"
 • "3500 celular em 10x"

*2. REGISTRO POR FOTO* 📸
 • _Nota Fiscal de Loja_
 • _Conta de Consumo (água, luz, etc.)_
 • _Comprovante de PIX_

*3. RELATÓRIOS E CONSULTAS* 📊
 • "saldo": Mostra o saldo do mês atual
 • "gasto total" ou "receita total":
  - Para o mês atual: "gasto total"
  - Para um intervalo: "receita de 01/10 a 15/10"*
  - Para um único dia: "gastos do dia 20/09", "gastos de ontem"
  - Depois, envie "detalhes" para ver a lista de itens.
 • _Gráfico de Barras:_ "quais meus gastos nos últimos 7 dias"
 • _Gráfico de Pizza (Gastos):_ "onde gastei nos últimos 15 dias"
 • _Gráfico de Pizza (Receitas):_ "gráfico dos meus ganhos"

 *4. ORGANIZAÇÃO* ⏰
 • "me lembre de pagar o aluguel dia 5"
 • "quais são meus lembretes"
 • "parcelamentos ativos"

*5. CONTROLE DE ESTOQUE (💎 PLANO DIAMANTE)* 📦
 • _Criar um Estoque:_ "criar estoque de camisetas"
 • _Adicionar Produto:_ "adicionar camiseta"
 • _Ver Produtos:_ "ver estoque de camisetas"
 • _Movimentar Estoque:_ "vendi 2 #P0001" ou "entrada 10 #P0002"
 • _Definir Alerta:_ "alerta #P0001 para 5 unidades"

*6. EXCLUIR REGISTROS* 🗑️
Use sempre o ID (#...) fornecido na mensagem de confirmação.
 • "remover gasto #a4b8c"
 • "excluir parcelamento #J-9tpH"
 • "apagar lembrete #d9bdd3"

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
