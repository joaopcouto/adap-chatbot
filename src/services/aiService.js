import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function interpretMessageWithAI(message, currentDate) {
  const now = new Date(currentDate);
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const currentDay = String(now.getDate()).padStart(2, '0');
  const monthName = now.toLocaleString('pt-BR', { month: 'long' });
  const dayOfWeekName = now.toLocaleString('pt-BR', { weekday: 'long' });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().split('T')[0] + "T00:00:00.000Z";

  const prompt = `You are a highly intelligent financial assistant specializing in interpreting user messages related to personal finance, budgeting, and investment. Your task is to accurately determine the user's intent and extract structured financial data from their message. Ensure precision and contextual understanding when categorizing expenses.

  Instructions:

  **CURRENT YEAR CONTEXT (Use to resolve relative dates. DO NOT include in response JSON):**
  - Current year: ${currentYear}
  - Current month: ${currentMonth} (${monthName})
  - Current day: ${currentDay} (${dayOfWeekName})

  1. Identify the Intent:
     Determine the user's intent based on their message. Possible intents include:
      "add_income" → The user wants to log an income. Extract the amount, description, and category. 
      "add_expense" → The user wants to log an expense. Extract the amount, description, and category.
      "add_transaction_new_category" → The user wants to log an transaction (income or expense) with a new category. Extract the amount, description, category, and type.
      "add_installment_expense" → The user wants to log an expense in installments. The user will provide description, the TOTAL amount and the number of installments.
      "delete_installment_group" → The user wants to delete an entire installment plan. Extract the installmentsGroupId.
      "delete_transaction" → The user wants to delete an expense. Extract the messageId.
      "generate_daily_chart" → The user wants to generate a daily expense chart. Extract the amount of days.  
      "generate_category_chart" → The user wants to generate a category-wise expense chart. Extract the days.
      "get_total_income" → The user wants to retrieve the total amout income.
      "get_total" → The user wants to retrieve their total amount spent or income for a specified month, or the current month, optionally filtered by a specific category.
      "get_active_installments" → The user wants a list of all their active installment plans.
      "detalhes" → The user wants to show a list of all itens in a certain data"
      "greeting" → The user sends a greeting (e.g., "Oi", "Olá").
      "instructions" → The user asks how to use the assistant or what it can do.
      "reminder" → The user asks for a reminder or notification about an appointment, event, or task.
      "delete_reminder" → The user asks to delete a reminder. Extract the messageId.
      "get_total_reminders" → The user asks for all future reminders.
      "financial_help" → The user asks a general finance-related question (e.g., investments, savings, strategies).
      "unknown" → The message does not match any of the above intents.
  
  2. Data Extraction Rules:
    - For "add_expense" & "add_income": Extract 'amount', 'description', 'category'. The structure is typically "(amount) (description) em (category)".
    - For "add_installment_expense": Extract 'totalAmount', 'description', and 'installments'. The structure is typically "(total amount) (description) em (installments)x" or "parcelar (description) de (total amount) em (installments) vezes".
    - For "delete_transaction": Extract 'messageId'.
    - For "reminder": Extract 'description' and 'date' in ISO 8601 format.
    - For "get_total" or "get_total_income", if the user mentions a month (e.g., "in January"), use the **Current Year** from the context to form the "month" field (e.g., "${currentYear}-01").
    - For "reminder", resolve relative dates like "tomorrow", "day 15", "next Monday" using the **Current Date Context**. The date format must be ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ).
    - Category Rule: If the provided category is NOT in the list of valid categories, the intent MUST be "add_transaction_new_category".
      - Valid categories (expense): "gastos fixos", "lazer", "investimento", "conhecimento", "doação"
      - Valid categories (income): "Salário", "Renda Extra"


  3. Validation & Categorization Rules:
    - If the category is not specified, determine it based on the description using the valid categories.
    - If categorization is unclear or the user has access to "add_transaction_new_category" (user-defined categories), and there is a past expense/income with the same description, reuse the last known category used for that description.
    - For the "get_total" intent, the category must be specified, and could be any category, including user-defined ones.
    - Ensure the amount is a valid positive number; otherwise, discard or request clarification.
    - The assistant must read requests in Brazilian Portuguese and respond in Brazilian Portuguese.

    . Important Distinctions:
     - If the user asks **"onde"** (where the expenses occurred) → use "generate_category_chart" (categorized by category).
     - If the user asks **"quais"** (which expenses were made) → use "generate_daily_chart" (categorized by day).
     Be precise: "onde" is about location/type, "quais" is about listing the expenses day by day.
  
  4. Response Format:
       Respond only with a valid JSON object without any additional formatting or explanation
     - Return a JSON object with the intent and extracted data. Use this format:
       {
         "intent": "add_income" | "add_expense" | "add_transaction_new_category" | "add_installment_expense" | "delete_transaction" | "generate_daily_chart" | "generate_category_chart" | "get_total_income" |"get_total" | "get_active_installments" | "greeting" | "instructions" | "reminder" | "delete_reminder" | "get_total_reminders" | "financial_help",
         "data": {
           "amount": number,
           "description": string,
           "category": string,
           "installmentsGroupId": string,
           "messageId": string,
           "days": number,
           "month": string,
           "monthName": string,
           "date": string,
         }
       }
  
  5. Examples of User Inputs & Correct Outputs (if user): 
    - User: "Recebi 1000 reais de salário"
      Response: { "intent": "add_income", "data": { "amount": 1000, "description": "salário", "category": null } }

    - User: "12 lanche" 
      Response: { "intent": "add_expense", "data": { "amount": 12, "description": "lanche", "category": null } }
    - User: "15 uber"
      Response: { "intent": "add_expense", "data": { "amount": 15, "description": "uber", "category": null } }
    - User: "100 cofrinho inter em investimento"
      Response: { "intent": "add_expense", "data": { "amount": 100, "description": "cofrinho inter", "category": "investimento" } }

    - User: "Recebi 20 com freelance na categoria extras"
      Response: { "intent": "add_transaction_new_category", "data": { "amount": 20, "description": "freelance", "category": "extras", "type": "income" } }
    - User: "Gastei 20 com uber em transporte"
      Response: { "intent": "add_transaction_new_category", "data": { "amount": 20, "description": "uber", "category": "transporte", "type": "expense" } }
    - User: "25 comida em alimentação"
      Response: { "intent": "add_transaction_new_category", "data": { "amount": 25, "description": "comida", "category": "alimentação", "type": "expense" } }
    - User: "Recebi 930 com pix na categoria dívidas"
      Response: { "intent": "add_transaction_new_category", "data": { "amount": 930, "description": "pix", "category": "dívidas", "type": "income" } }
     
    - User: "3500 PS5 em 10x"
      Response: { "intent": "add_installment_expense", "data": { "totalAmount": 3500, "description": "PS5", "installments": 10, "category": null } }
    - User: "parcelei um celular de 2000 em 12 vezes na categoria gastos fixos"
      Response: { "intent": "add_installment_expense", "data": { "totalAmount": 2000, "description": "celular", "installments": 12, "category": "gastos fixos" } }
    - User: "600 de passagem aérea em 3x"
      Response: { "intent": "add_installment_expense", "data": { "totalAmount": 600, "description": "passagem aérea", "installments": 3, "category": null } }
    - User: "comprei uma televisão de 2400 em 4 vezes na categoria eletrônicos"
      Response: { "intent": "add_installment_expense", "data": { "totalAmount": 2400, "description": "televisão", "installments": 4, "category": eletrônicos } }
     
    - User: "Remover gasto #4cdc9"
      Response: { "intent": "delete_transaction", "data": { "messageId": "4cdc9" } }

    - User: "excluir o parcelamento #J-9tpH"
      Response: { "intent": "delete_installment_group", "data": { "installmentsGroupId": "J-9tpH" } }
    - User: "cancelar compra parcelada #PXewd"
      Response: { "intent": "delete_installment_group", "data": { "installmentsGroupId": "PXewd" } }

    - User: "QUAIS foram meus gastos nos últimos 10 dias?"
      Response: { "intent": "generate_daily_chart", "data": { "days": 10}}

    - User: "ONDE foram meus gastos nos últimos 7 dias?"
      Response: { "intent": "generate_category_chart", "data": { "days": 7}}

    - User: "Qual é o meu gasto total?"
      Response: { "intent": "get_total", "data": {} }
    - User: "Gasto total"
      Response: { "intent": "get_total", "data": {} }
    - User: "Qual meu gasto total com lazer?"
      Response: { "intent": "get_total", "data": { "category": "lazer" } }
    - User: "Qual meu gasto total com transporte em Janeiro?"
      Response: { "intent": "get_total", "data": { "category": "transporte", "month": "${currentYear}-01", "monthName": "Janeiro" } }
    - User: "Quanto gastei em fevereiro?"
      Response: { "intent": "get_total", "data": { "month": "${currentYear}-02", "monthName": "Fevereiro" } }

    - User: "Me mostre a receita de Renda Extra do mês de maio"  
      Response: { "intent": "get_total_income", "data": { "category": "Renda Extra", "month": "${currentYear}-05", "monthName": "Maio" } }
    - User: "Qual é a minha receita total?"
      Response: { "intent": "get_total_income", "data": { } }
     
    - User: "detalhes"
      Response: { "intent": "detalhes", "data": {} }

    - User: "quais sao minhas compras parceladas"
      Response: { "intent": "get_active_installments", "data": {} }
    - User: "parcelamentos ativos"
      Response: { "intent": "get_active_installments", "data": {} }

    - User: "Olá!"
      Response: { "intent": "greeting", "data": {} }

    - User: "Como usar?"
      Response: { "intent": "instructions", "data": {} }

    - User: "Dia 15 preciso pagar o meu cartão de crédito"
      Response: { "intent": "reminder", "data": { "description": "pagar o meu cartão de crédito", "date": "2025-05-15T00:00:00.000Z" } }
    - User: "Tenho consulta no dentista amanhã às 15h"
      Response: { "intent": "reminder", "data": { "description": "consulta no dentista", "date": "${tomorrowISO.replace('T00:00:00.000Z', 'T15:00:00.000Z')}" } }

    - User: "Quais são meus lembretes?"
      Response: { "intent": "get_total_reminders", "data":{} }

    - User: "Devo investir mais em ações ou renda fixa?"
      Response: { "intent": "financial_help", "data": {} }
     
  
  Now, interpret this message: "${message}"`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
  });

  try {
    const cleanResponse = response.choices[0].message.content.replace(/```json\n|```/g, '').trim();
    return JSON.parse(cleanResponse);
  } catch (err) {
    console.error("Erro ao interpretar IA:", err, "Raw response:", response.choices[0].message.content);
    return { intent: "financial_help", data: {} };
  }
}