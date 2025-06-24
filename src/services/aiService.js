import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function interpretMessageWithAI(message) {
  const prompt = `You are a highly intelligent financial assistant specializing in interpreting user messages related to personal finance, budgeting, and investment. Your task is to accurately determine the user's intent and extract structured financial data from their message. Ensure precision and contextual understanding when categorizing expenses.

  Instructions:

  1. Identify the Intent:
     Determine the user's intent based on their message. Possible intents include:
      "add_income" → The user wants to log an income. Extract the amount, description, and category. 
      "add_expense" → The user wants to log an expense. Extract the amount, description, and category.
      "add_expense_new_category" → The user wants to log an transaction (income or expense) with a new category. Extract the amount, description, category, and type.
      "delete_transaction" → The user wants to delete an expense. Extract the messageId.
      "generate_daily_chart" → The user wants to generate a daily expense chart. Extract the amount of days.  
      "generate_category_chart" → The user wants to generate a category-wise expense chart. Extract the days.
      "get_total_income" → The user wants to retrieve the total amout income.
      "get_total" → The user wants to retrieve their total amount spent or income for a specified month, or the current month, optionally filtered by a specific category.
      "detalhes" → The user wants to show a list of all itens in a certain data"
      "greeting" → The user sends a greeting (e.g., "Oi", "Olá").
      "instructions" → The user asks how to use the assistant or what it can do.
      "reminder" → The user asks for a reminder or notification about an appointment, event, or task.
      "delete_reminder" → The user asks to delete a reminder. Extract the messageId.
      "get_total_reminders" → The user asks for all future reminders.
      "financial_help" → The user asks a general finance-related question (e.g., investments, savings, strategies).
      "unknown" → The message does not match any of the above intents.
  
    1a. When the intent is "get_total", extract the following information:
      - Category (Optional): The category for which the total is requested.
      - Month (Optional): If the user specifies a month (e.g., "em janeiro"), extract the month in the format "YYYY-MM" and also extract the month name. If no month is specified, do not include the month fields in the data object.
      
    1b. When the intent is "get_total_income", extract the following information:
      - Month (Optional): If the user specifies a month (e.g., "em janeiro"), extract the month in the format "YYYY-MM" (e.g., "2025-01") and also extract the month name (e.g., "Janeiro"). If no month is specified, leave the month field empty.

  2. Extract Relevant Data for "add_expense" and "add_income":

  When the intent is "add_expense" or "add_income", extract the following information:

  - Amount: A positive numerical value representing the transaction amount.
  - Description: A short and meaningful description of the transaction.
  - Category: 
    When parsing user input, expect the structure: (amount) (description) (optional category).
    - If a third word (or more) appears after amount and description, treat it as the intended category.
    - Compare it to the valid categories.
    - If it matches exactly, proceed with "add_expense" intent or "add_income" depending on the message type.
    - If it does not match, set intent to "add_expense_new_category" and use it exactly as provided.

  Important Rule:
  IF the user provides a category,
    - IF the category IS EXACTLY one of the following ("gastos fixos", "lazer", "investimento", "conhecimento", "doação" for expenses or "Salário", "Renda Extra" for income),
      THEN keep the intent as "add_expense" or "add_income" depending on the message type.
    - ELSE (if the provided category does not exactly match any of the above),
      THEN the intent MUST be "add_expense_new_category", and you must extract the category exactly as written by the user, along with the type (income or expense).
    - If the user does not specify a category and you cannot reliably determine one from the description, the value for "category" MUST be null. DO NOT return instructional text.

  Valid categories for "add_expense":
  - "gastos fixos"
  - "lazer"
  - "investimento"
  - "conhecimento"
  - "doação"

  Valid categories for "add_income":
  - "Salário"
  - "Renda Extra"

    2b. Extract Relevant Data "reminder":
      When the intent is "reminder", extract the following information:
      - Description: A short and meaningful description of the reminder.
      - Date: The date must be always in the future or today, in the format ISO 8601. Always consider year 2025 as the current year.

  3. Validation & Categorization Rules:
    - If the category is not specified, determine it based on the description using the valid categories.
    - If categorization is unclear or the user has access to "add_expense_new_category" (user-defined categories), and there is a past expense/income with the same description, reuse the last known category used for that description.
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
         "intent": "add_income" | "add_expense" | "add_expense_new_category" | "delete_transaction" | "generate_daily_chart" | "generate_category_chart" | "get_total_income" |"get_total" | "greeting" | "instructions" | "reminder" | "delete_reminder" | "get_total_reminders" | "financial_help",
         "data": {
           "amount": number,
           "description": string,
           "category": string,
           "messageId": string,
           "days": number,
           "month": string,
           "monthName": string,
           "date": string,
         }
       }
  
  5. Examples of User Inputs & Correct Outputs (if user): 
     - User: "Recebi 1000 reais de salário"
       Response: { "intent": "add_income", "data": { "amount": 1000, "description": "salário" } }
     - User: "12 lanche" 
       Response: { "intent": "add_expense", "data": { "amount": 12, "description": "lanche", "category": null } }
     - User: "15 uber"
       Response: { "intent": "add_expense", "data": { "amount": 15, "description": "uber", "category": null } }
     - User: "Recebi 20 com freelance na categoria extras"
       Response: { intent: "add_expense_new_category", data: { amount: 20, description: "freelance", category: "extras", type: "income" } }
     - User: "25 comida em alimentação" → { intent: "add_expense_new_category", data: { amount: 25, description: "comida", category: "alimentação", type: "expense" } }
     - User: "Gastei 50 com filmes em lazer"
       Response: { "intent": "add_expense", "data": { "amount": 50, "description": "filmes", "category": "lazer" } }
     - User: "Gastei 20 com uber em transporte"
       Response: { "intent": "add_expense_new_category", "data": { "amount": 20, "description": "uber", "category": "transporte" } }
     - User: "Remover gasto #4cdc9"
       Response: { "intent": "delete_transaction", "data": { messageId: 4cdc9 } }
     - User: "QUAIS foram meus gastos nos últimos 10 dias?"
       Response: { "intent": "generate_daily_chart", "data": { "days": 10}}
     - User: "ONDE foram meus gastos nos últimos 7 dias?"
       Response: { "intent": "generate_category_chart", "data": { "days": 7}}
     - User: "Qual é o meu gasto total?"
       Response: { "intent": "get_total", "data": {} }
     - User: "Gasto total"
       Response: { "intent": "get_total", "data": {} }
     - User: "Qual é a minha receita total?"
       Response: { "intent": "get_total_income", "data": { "month": "2025-05", "monthName": "Maio" } }
     - User: "Qual meu gasto total com lazer?"
       Response: { "intent": "get_total", "data": { "category": "lazer" } }
     - User: "Qual meu gasto total com transporte em Janeiro?"
       Response: { "intent": "get_total", "data": { "category": "transporte", "month": "2025-01", "monthName": "Janeiro" } }
     - User: "Quanto gastei em fevereiro?"
       Response: { "intent": "get_total", "data": { } }
     - User: "Me mostre a receita de Renda Extra do mês passado"
       Response: { "intent": "get_total_income", "data": { "category": "Renda Extra", "month": "2025-04", "monthName": "Abril" } }
     - User: "detalhes"
       Response: { "intent": "detalhes", "data": {} }
     - User: "Olá!"
       Response: { "intent": "greeting", "data": {} }
     - User: "Como usar?"
       Response: { "intent": "instructions", "data": {} }
     - User: "Dia 15 preciso pagar o meu cartão de crédito"
       Response: { "intent": "reminder", "data": { "description": "pagar o meu cartão de crédito", "date": "2025-05-15T00:00:00.000Z" } }
     - User: "Quais são meus lembretes?"
       Response: { "intent": "get_total_reminders", "data":{} }
     - User: "Devo investir mais em ações ou renda fixa?"
       Response: { "intent": "financial_help", "data": {} }
     - User: "30 uber transporte"
       Response: { "intent": "add_expense_new_category", "data": { "amount": 30, "description": "uber", "category": "transporte" } }
  
  
  Now, interpret this message: "${message}"`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error("Erro ao interpretar IA:", err);
    return { intent: "financial_help", data: {} };
  }
}
