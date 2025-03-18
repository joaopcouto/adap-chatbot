import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import mongoose from "mongoose";
import { OpenAI } from "openai";
import { customAlphabet } from "nanoid";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const imagesPath = path.join(__dirname, "images");
app.use("/images", (req, res, next) => {
  console.log(`📂 Pedido recebido: ${req.url}`);
  express.static(imagesPath)(req, res, next);
});

const dbName = process.env.NODE_ENV === "prod" ? "prod" : "test";

mongoose
  .connect(process.env.MONGO_URI, {
    dbName: dbName,
  })
  .then(() => console.log("Conectado ao MongoDB com sucesso!"))
  .catch((err) => console.error("Erro ao conectar ao MongoDB:", err));

const VALID_CATEGORIES = [
  "gastos fixos",
  "lazer",
  "investimento",
  "conhecimento",
  "doação",
  "outro",
];

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generateId = customAlphabet("1234567890abcdef", 5);

const expenseSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  description: String,
  category: { type: String, enum: VALID_CATEGORIES },
  date: { type: Date, default: Date.now },
  messageId: String,
});
const Expense = mongoose.model("Expense", expenseSchema);

async function interpretMessageWithAI(message) {
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
         "intent": "add_expense" | "delete_expense" | "generate_daily_chart" | "generate_category_chart" | "get_total" | "get_total_all" | "greeting" | "instructions" | "financial_help",
         "data": {
           "amount": number,
           "description": string,
           "category": string,
           "messageId": string,
           "days": number,
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
    console.error("Erro ao interpretar a resposta da IA:", err);
    return { intent: "financial_help", data: {} };
  }
}

async function calculateTotalExpenses(userId, category = null) {
  const filter = category ? { userId, category } : { userId };
  try {
    const result = await Expense.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return result.length ? result[0].total : 0;
  } catch (err) {
    console.error("Erro ao calcular o total de despesas:", err);
    return 0;
  }
}

async function calculateTotalExpensesAll(userId) {
  try {
    const result = await Expense.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return result.length ? result[0].total : 0;
  } catch (err) {
    console.error("Erro ao calcular o total de despesas:", err);
    return 0;
  }
}

async function getExpensesReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const expenses = await Expense.aggregate([
    { $match: { userId, date: { $gte: startDate } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return expenses;
}

async function generateChart(expenses, userId) {
  return new Promise((resolve, reject) => {
    // 🛠️ Substituir caracteres inválidos para nome de arquivo
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, "_");

    const tempFilePath = path.join(
      __dirname,
      `images/temp_expenses_${sanitizedUserId}.json`
    );
    const outputImagePath = path.join(
      __dirname,
      "images",
      `report_${sanitizedUserId}.png`
    );

    // 🚀 Salva o JSON corretamente antes de chamar o Python
    fs.writeFileSync(tempFilePath, JSON.stringify(expenses, null, 2));

    // Verifica se o JSON foi salvo corretamente
    if (!fs.existsSync(tempFilePath)) {
      console.error("❌ Erro: O JSON não foi salvo corretamente.");
      reject("Erro ao salvar o JSON.");
      return;
    }

    console.log("✅ JSON salvo:", tempFilePath);

    // Chama o Python para gerar o gráfico
    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const script = spawn(pythonCommand, [
      "generate_chart.py",
      tempFilePath,
      outputImagePath,
    ]);

    script.stdout.on("data", (data) => {
      console.log("📊 Caminho da imagem gerada:", data.toString().trim());

      if (fs.existsSync(outputImagePath)) {
        console.log("✅ Imagem gerada com sucesso!");
        resolve(`report_${sanitizedUserId}.png`);
      } else {
        console.error("❌ Erro: O arquivo da imagem não foi criado!");
        reject("Erro: A imagem não foi gerada corretamente.");
      }
    });

    script.stderr.on("data", (data) => {
      console.error("❌ Erro no Python:", data.toString());
      reject("Erro na execução do Python: " + data.toString());
    });

    script.on("exit", () => {
      console.log("🗑️ Removendo JSON temporário...");
      // fs.unlinkSync(tempFilePath);
    });
  });
}

function formatPhoneNumber(userId) {
  let formatted = userId.replace(/\s+/g, "").trim(); // Remove espaços extras
  if (!formatted.startsWith("whatsapp:")) {
    formatted = `whatsapp:${formatted}`;
  }
  return formatted;
}

async function sendReportImage(userId, imageFilename) {
  const formattedNumber = formatPhoneNumber(userId);
  const imageUrl = `https://2e19-187-95-20-14.ngrok-free.app/images/${imageFilename}`;

  console.log(`📞 Enviando mensagem para: ${formattedNumber}`);
  console.log(`🖼️ URL da imagem: ${imageUrl}`);

  try {
    const message = await client.messages.create({
      from: "whatsapp:+14155238886", // Número do Twilio
      to: formattedNumber,
      mediaUrl: [imageUrl], // MediaUrl precisa ser um array
      body: "📊 Relatório de gastos",
    });

    console.log(`✅ Mensagem enviada com sucesso! SID: ${message.sid}`);
  } catch (error) {
    console.error("❌ Erro ao enviar relatório:", error);
  }
}

async function getCategoryReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const categoryExpenses = await Expense.aggregate([
    { $match: { userId, date: { $gte: startDate } } },
    {
      $group: {
        _id: "$category",
        total: { $sum: "$amount" },
      },
    },
  ]);

  return categoryExpenses;
}

async function generateCategoryChart(expenses, userId) {
  return new Promise((resolve, reject) => {
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, "_");

    const tempFilePath = path.join(
      __dirname,
      `images/temp_category_${sanitizedUserId}.json`
    );
    const outputImagePath = path.join(
      __dirname,
      "images",
      `category_report_${sanitizedUserId}.png`
    );

    fs.writeFileSync(tempFilePath, JSON.stringify(expenses, null, 2));

    if (!fs.existsSync(tempFilePath)) {
      console.error("❌ Erro: O JSON não foi salvo corretamente.");
      reject("Erro ao salvar o JSON.");
      return;
    }

    console.log("✅ JSON salvo:", tempFilePath);

    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const script = spawn(pythonCommand, [
      "generate_category_chart.py",
      tempFilePath,
      outputImagePath,
    ]);

    script.stdout.on("data", (data) => {
      console.log("📊 Caminho da imagem gerada:", data.toString().trim());

      if (fs.existsSync(outputImagePath)) {
        console.log("✅ Imagem gerada com sucesso!");
        resolve(`category_report_${sanitizedUserId}.png`);
      } else {
        console.error("❌ Erro: O arquivo da imagem não foi criado!");
        reject("Erro: A imagem não foi gerada corretamente.");
      }
    });

    script.stderr.on("data", (data) => {
      console.error("❌ Erro no Python:", data.toString());
      reject("Erro na execução do Python: " + data.toString());
    });

    script.on("exit", () => {
      console.log("🗑️ Removendo JSON temporário...");
      // fs.unlinkSync(tempFilePath);
    });
  });
}

function sendGreetingMessage(twiml) {
  twiml.message(
    `Olá! Bem-vindo! 🤗\n\nAqui está um breve tutorial:\n\n1️⃣ Digite um gasto (Ex.: Gastei 150 reais no mercado em gastos fixos).\n2️⃣ Veja seu dinheiro controlado!\n\n💬 Teste agora: “Gastei 50 com cinema em lazer”`
  );
}

function sendHelpMessage(twiml) {
  twiml.message(
    `🤖 *Como usar o ADP*:\n\n` +
      `1. Para adicionar uma despesa, digite:\n` +
      `   - "Gastei 50 no cinema em lazer"\n` +
      `   - "30 reais em café em outros"\n\n` +
      `2. Para ver o total de gastos, digite:\n` +
      `   - "Qual meu gasto total em lazer?"\n` +
      `   - "Gasto total"\n\n` +
      `💡 *Dica*: Você pode usar categorias como:\n` +
      `   - Gastos fixos\n` +
      `   - Lazer\n` +
      `   - Investimento\n` +
      `   - Conhecimento\n` +
      `   - Doação\n` +
      `   - Outro\n\n` +
      `Exemplo completo: "Gastei 100 em mercado em gastos fixos"`
  );
}

async function sendFinancialHelpMessage(twiml, message) {
  const prompt = `Você é um assistente financeiro especializado em ajudar usuários com dúvidas sobre investimentos, finanças pessoais e planejamento. Responda à seguinte pergunta de forma clara e útil, em português brasileiro:

Pergunta: "${message}"`;

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
  });

  twiml.message(response.choices[0].message.content);
}

function sendExpenseAddedMessage(twiml, expenseData) {
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

function sendExpenseDeletedMessage(twiml, expenseData) {
  twiml.message(
    `❌ Gasto #_${expenseData.messageId}_ removido. 
    `
  );
}

function sendTotalExpensesMessage(twiml, total, category) {
  const categoryMessage = category
    ? ` em _*${category.charAt(0).toUpperCase() + category.slice(1)}*_`
    : "";
  twiml.message(`*Gasto total*${categoryMessage}:\nR$ ${total.toFixed(2)}`);
}

function sendTotalExpensesAllMessage(twiml, total) {
  twiml.message(`*Gasto total*:\nR$ ${total.toFixed(2)}`);
}

app.post("/webhook", async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const userMessage = req.body.Body;
  const userId = req.body.From;

  try {
    const interpretation = await interpretMessageWithAI(userMessage);

    switch (interpretation.intent) {
      case "add_expense":
        const { amount, description, category } = interpretation.data;
        if (VALID_CATEGORIES.includes(category)) {
          const newExpense = new Expense({
            userId,
            amount,
            description,
            category,
            date: new Date(),
            messageId: generateId(),
          });
          await newExpense.save();
          sendExpenseAddedMessage(twiml, newExpense);
        } else {
          sendHelpMessage(twiml);
        }
        break;

      case "delete_expense":
        const { messageId } = interpretation.data;

        try {
          const expense = await Expense.findOneAndDelete({ userId, messageId });

          if (expense) {
            sendExpenseDeletedMessage(twiml, expense);
          } else {
            twiml.message(
              `🚫 Nenhum gasto encontrado com o ID #_${messageId}_ para exclusão.`
            );
          }
        } catch (error) {
          console.error("Erro ao excluir despesa pelo messageId:", error);
          twiml.message(
            "🚫 Ocorreu um erro ao tentar excluir a despesa. Tente novamente."
          );
        }
        break;

      case "generate_daily_chart":
        try {
          const days = interpretation.data.days || 7;
          const reportData = await getExpensesReport(userId, days);

          if (reportData.length === 0) {
            twiml.message(
              `📉 Não há registros de gastos nos últimos ${days} dias.`
            );
          } else {
            const imageFilename = await generateChart(reportData, userId);
            await sendReportImage(userId, imageFilename);
          }
        } catch (error) {
          console.error("Erro ao gerar gráfico:", error);
          twiml.message(
            "❌ Ocorreu um erro ao gerar o relatório. Tente novamente."
          );
        }
        break;

      case "generate_category_chart":
        try {
          const days = interpretation.data.days || 30; // Por padrão, pega os últimos 30 dias
          const categoryReport = await getCategoryReport(userId, days);

          if (categoryReport.length === 0) {
            twiml.message(
              `📊 Não há registros de gastos nos últimos ${days} dias para gerar um relatório por categoria.`
            );
          } else {
            const imageFilename = await generateCategoryChart(
              categoryReport,
              userId
            );
            await sendReportImage(userId, imageFilename);
          }
        } catch (error) {
          console.error("Erro ao gerar gráfico por categorias:", error);
          twiml.message(
            "❌ Ocorreu um erro ao gerar o relatório por categorias. Tente novamente."
          );
        }
        break;

      case "get_total":
        const total = await calculateTotalExpenses(
          userId,
          interpretation.data.category
        );
        sendTotalExpensesMessage(twiml, total, interpretation.data.category);
        break;

      case "get_total_all":
        const totalAll = await calculateTotalExpensesAll(userId);
        sendTotalExpensesAllMessage(twiml, totalAll);
        break;

      case "greeting":
        sendGreetingMessage(twiml);
        break;

      case "financial_help":
        await sendFinancialHelpMessage(twiml, userMessage);
        break;

      default:
        sendHelpMessage(twiml);
        break;
    }
  } catch (err) {
    console.error("Erro ao interpretar a mensagem:", err);
    sendHelpMessage(twiml);
  }

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
