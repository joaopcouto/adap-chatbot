import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export function sendGreetingMessage(twiml) {
  twiml.message(`👋 Oi, eu sou a ADAP – sua Assistente Direta ao Ponto.

Fui criada para te ajudar a organizar suas finanças de forma simples, direto por aqui no WhatsApp, sem complicação. 📊💸

Comigo, você consegue:

1️⃣ Anotar seus gastos e receitas em segundos
2️⃣ Anotar seus lembretes e compromissos de forma simples
3️⃣ Acompanhar seus gastos por categoria (Lazer, Gastos fixos, etc.)
4️⃣ Acompanhar seu gasto ou receita total
5️⃣ Simples de remover um gasto caso anote errado
6️⃣ Gerar gráfico de gastos dos últimos 7 dias
7️⃣ Gerar gráfico de gastos por categoria
8️⃣ Gerar relatórios de gastos e receitas, filtrando ou não por categoria
9️⃣ Dicas financeiras para o seu dia a dia

E tudo isso de forma automática. É só me mandar mensagens simples como:

1️⃣ "25 mercado" ou "recebi 2000 salário"
2️⃣ "Tenho reunião dia 15/06"
3️⃣ "gasto total lazer"
4️⃣ "gasto total" ou "receita total"
5️⃣ "remover #(código do gasto/receita)"
6️⃣ "quanto gastei nos últimos 7 dias"
7️⃣ "onde foram meus gastos nos últimos 30 dias?"
8️⃣ "qual meu gasto total em lazer?" ou "qual minha receita total em junho?"
9️⃣ "onde posso deixar meu dinheiro para render mais?"


🔐 Seus dados são 100% seguros e privados.

Ah, e aproveita pra nos seguir no Instagram também: @adapfinanceira

Lá tem dicas diárias pra você gastar melhor e fazer seu dinheiro render mais! 🚀`);
}

export function sendHelpMessage(twiml) {
  twiml.message(`👋 Oi, eu sou a ADAP – sua Assistente Direta ao Ponto.

Fui criada para te ajudar a organizar suas finanças de forma simples, direto por aqui no WhatsApp, sem complicação. 📊💸

Comigo, você consegue:

1️⃣ Anotar seus gastos e receitas em segundos
2️⃣ Anotar seus lembretes e compromissos de forma simples
3️⃣ Acompanhar seus gastos por categoria (Lazer, Gastos fixos, etc.)
4️⃣ Acompanhar seu gasto ou receita total
5️⃣ Simples de remover um gasto caso anote errado
6️⃣ Gerar gráfico de gastos dos últimos 7 dias
7️⃣ Gerar gráfico de gastos por categoria
8️⃣ Gerar relatórios de gastos e receitas, filtrando ou não por categoria
9️⃣ Dicas financeiras para o seu dia a dia

E tudo isso de forma automática. É só me mandar mensagens simples como:

1️⃣ "25 mercado" ou "recebi 2000 salário"
2️⃣ "Tenho reunião dia 15/06"
3️⃣ "gasto total lazer"
4️⃣ "gasto total" ou "receita total"
5️⃣ "remover #(código do gasto/receita)"
6️⃣ "quanto gastei nos últimos 7 dias"
7️⃣ "onde foram meus gastos nos últimos 30 dias?"
8️⃣ "qual meu gasto total em lazer?" ou "qual minha receita total em junho?"
9️⃣ "onde posso deixar meu dinheiro para render mais?"


🔐 Seus dados são 100% seguros e privados.

Ah, e aproveita pra nos seguir no Instagram também: @adapfinanceira

Lá tem dicas diárias pra você gastar melhor e fazer seu dinheiro render mais! 🚀`);
}

export function sendIncomeAddedMessage(twiml, incomeData) {
  twiml.message(
    `📝 *Receita adicionada*\n📌 ${incomeData.description.toUpperCase()} (_${
      incomeData.category.charAt(0).toUpperCase() + incomeData.category.slice(1)
    }_)\n💰 *R$ ${incomeData.amount.toFixed(
      2
    )}*\n\n📅 ${incomeData.date.toLocaleDateString("pt-BR")} - #${
      incomeData.messageId
    }`
  );
}

export function sendExpenseAddedMessage(twiml, expenseData) {
  twiml.message(
    `📝 *Gasto adicionado*\n📌 ${expenseData.description.toUpperCase()} (_${
      expenseData.category.charAt(0).toUpperCase() +
      expenseData.category.slice(1)
    }_)\n💰 *R$ ${expenseData.amount.toFixed(
      2
    )}*\n\n📅 ${expenseData.date.toLocaleDateString("pt-BR")} - #${
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
