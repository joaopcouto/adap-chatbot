import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function interpretMessageWithAI(message) {
  const prompt = `You are a highly intelligent financial assistant specializing in interpreting user messages related to personal finance, budgeting, and investment. Your task is to accurately determine the user's intent and extract structured financial data from their message. Ensure precision and contextual understanding when categorizing expenses.

  Instructions:

  1. Identify the Intent:
     Determine the user's intent based on their message. Possible intents include:
      "add_expense" → The user wants to log an expense. Extract the amount, description, and category.
      "delete_expense" → The user wants to delete an expense. Extract the messageId.
      "generate_daily_chart" → The user wants to generate a daily expense chart. Extract the amount of days.  
      "generate_category_chart" → The user wants to generate a category-wise expense chart. Extract the days.
      "get_total" → The user wants to retrieve the total amount spent. Extract the category if provided.
      "get_total_all" → The user wants to retrieve the total amount spent across all categories.
      "get_total_last_months" → The user wants to retrieve the total amount spent in the last months. Extract the month in two formats: "YYYY-MM" and "January 2025". If the user specify the past month, the assistant should return the total amount spent in that month.
      "greeting" → The user sends a greeting (e.g., "Oi", "Olá").
      "instructions" → The user asks how to use the assistant or what it can do.
      "financial_help" → The user asks a general finance-related question (e.g., investments, savings, strategies).
      "unknown" → The message does not match any of the above intents.
  
  2. Extract Relevant Data:
     When the intent is "add_expense", extract the following:
     - Amount: A positive numerical value representing the expense amount.
     - Description: A short but meaningful description of the expense.
     - Category: Assign the correct category based on the description if the user does not specify it. The valid categories are:
        "gastos fixos" (fixed expenses like rent, electricity, internet)
        "lazer" (entertainment and leisure activities such as dining out, theater)
        "investimento" (investments such as stocks, crypto, real estate)
        "conhecimento" (education-related spending, courses, books)
        "doação" (donations and charitable contributions)
        "outro" (anything that does not fit into the above categories)
        always try to fit the expense into one of the categories.
    When the intent is "delete_expense", extract the messageId: A short ID containing letters and numbers

  3. Validation & Categorization Rules:
    - If the category is not specified, determine it based on the description.
    - If the category is invalid or unclear, default to "outro".
    - Ensure the amount is a valid positive number; otherwise, discard or request clarification.
    - The assistant must read requests in Brazilian Portuguese and respond in Brazilian Portuguese.
  
  4. Response Format:
       Respond only with a valid JSON object without any additional formatting or explanation
     - Return a JSON object with the intent and extracted data. Use this format:
       {
         "intent": "add_expense" | "delete_expense" | "generate_daily_chart" | "generate_category_chart" | "get_total" | "get_total_all" | "get_total_last_months" | "greeting" | "instructions" | "financial_help",
         "data": {
           "amount": number,
           "description": string,
           "category": string,
           "messageId": string,
           "days": number,
           "month": string,
           "monthName": string,
         }
       }
  
  5. Examples of User Inputs & Correct Outputs:
     - User: "Gastei 50 com filmes em lazer"
       Response: { "intent": "add_expense", "data": { "amount": 50, "description": "filmes", "category": "lazer" } }
     - User: "Remover gasto #4cdc9"
       Response: { "intent": "delete_expense", "data": { messageId: 4cdc9 } }
     - User: "QUAIS foram meus gastos nos últimos 10 dias?"
       Response: { "intent": "generate_daily_chart", "data": { "days": 10}}
     - User: "ONDE foram meus gastos nos últimos 7 dias?"
       Response: { "intent": "generate_category_chart", "data": { "days": 7}}
     - User: "Qual é o meu gasto total em gastos fixos?"
       Response: { "intent": "get_total", "data": { "category": "gastos fixos" } }
     - User: "Qual é o meu gasto total?"
       Response: { "intent": "get_total_all", "data": {} }
     - User: "Quanto gastei no mês de fevereiro?" 
       Response: { "intent": "get_total_last_months", "data": { "month": "2025-02", "monthName": "Fevereiro" }}
     - User: "Olá!"
       Response: { "intent": "greeting", "data": {} }
     - User: "Como usar?"
       Response: { "intent": "instructions", "data": {} }
     - User: "Devo investir mais em ações ou renda fixa?"
       Response: { "intent": "financial_help", "data": {} }
  

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