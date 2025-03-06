require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const mongoose = require("mongoose");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .catch((err) => console.error("MongoDB connection error:", err));

const VALID_CATEGORIES = [
  "gastos fixos",
  "lazer",
  "investimento",
  "conhecimento",
  "doação",
  "outro",
];

const MESSAGE_PATTERNS = {
  expense: [
    /Gastei (\d+) reais com (.+) em (.+)/i,
    /(\d+) com (.+) em (.+)/i,
    /(\d+) em (.+) em (.+)/i,
    /(\d+) (.+) em (.+)/i,
  ],
  total: [/Gasto total em (.+)/i, /Gasto total/i],
  greeting: /^(Olá|Oi|ola|oi)/i,
};

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const expenseSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  description: String,
  category: { type: String, enum: VALID_CATEGORIES },
  date: { type: Date, default: Date.now },
});
const Expense = mongoose.model("Expense", expenseSchema);

function extractExpenseData(message) {
  for (const pattern of MESSAGE_PATTERNS.expense) {
    const match = message.match(pattern);
    if (match) {
      const amount = parseFloat(match[1]);
      const description = match[2].trim();
      const category = match[3].trim().toLowerCase();

      if (VALID_CATEGORIES.includes(category)) {
        return { amount, description, category, date: new Date() };
      }
    }
  }

  for (const pattern of MESSAGE_PATTERNS.total) {
    const match = message.match(pattern);
    if (match) {
      const category = match[1] ? match[1].trim().toLowerCase() : null;
      if (!category || VALID_CATEGORIES.includes(category)) {
        return { totalRequest: true, category };
      }
    }
  }

  return null;
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
    console.error("Error calculating total expenses:", err);
    return 0;
  }
}

function sendGreetingMessage(twiml) {
  twiml.message(
    `Olá! Bem-vindo! 🤗\n\nAqui está um breve tutorial:\n\n1️⃣ Digite um gasto (Ex.: Gastei 150 reais no mercado em gastos fixos).\n2️⃣ Veja seu dinheiro controlado!\n\n💬 Teste agora: “Gastei 50 com cinema em lazer”`
  );
}

function sendInvalidFormatMessage(twiml) {
  twiml.message(
    "Formato inválido. Use:\n" +
      '"Gastei (valor) com (descrição) em (categoria)"\n' +
      'ou "(valor) (descrição) em (categoria)"\n' +
      "Categorias: " +
      VALID_CATEGORIES.join(", ") +
      '\nExemplo: "Gastei 20 reais com Açaí em lazer"'
  );
}

function sendExpenseAddedMessage(twiml, expenseData, total) {
  twiml.message(
    `*Gasto adicionado*\n📌 ${expenseData.description.toUpperCase()} (_${
      expenseData.category.charAt(0).toUpperCase() +
      expenseData.category.slice(1)
    }_)\n*R$ ${expenseData.amount.toFixed(
      2
    )}*\n\n${expenseData.date.toLocaleDateString("pt-BR")}`
  );
}

function sendTotalExpensesMessage(twiml, total, category) {
  const categoryMessage = category
    ? ` em _*${category.charAt(0).toUpperCase() + category.slice(1)}*_`
    : "";
  twiml.message(`*Gasto total*${categoryMessage}:\nR$ ${total.toFixed(2)}`);
}

app.post("/webhook", async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const userMessage = req.body.Body;
  const userId = req.body.From;

  if (MESSAGE_PATTERNS.greeting.test(userMessage)) {
    sendGreetingMessage(twiml);
  } else {
    const expenseData = extractExpenseData(userMessage);

    if (!expenseData) {
      sendInvalidFormatMessage(twiml);
    } else if (expenseData.totalRequest) {
      const total = await calculateTotalExpenses(userId, expenseData.category);
      sendTotalExpensesMessage(twiml, total, expenseData.category);
    } else {
      const newExpense = new Expense({ ...expenseData, userId });
      try {
        await newExpense.save();
        const total = await calculateTotalExpenses(userId);
        sendExpenseAddedMessage(twiml, expenseData, total);
      } catch (err) {
        console.error("Error saving expense:", err);
        twiml.message("Erro ao salvar gasto.");
      }
    }
  }

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
