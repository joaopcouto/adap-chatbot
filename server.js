require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const mongoose = require('mongoose');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Conectar ao MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Definir o schema e modelo para os gastos
const expenseSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  description: String,
  date: { type: Date, default: Date.now }
});

const Expense = mongoose.model('Expense', expenseSchema);

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);

// Função para extrair valor e descrição da mensagem
function extractExpenseData(message) {
  const patterns = [
    /Gastei (\d+) reais com (.+)/,
    /gastei (\d+) reais com (.+)/,
    /(\d+) com (.+)/,
    /(\d+) em (.+)/,
    /(\d+) (.+)/
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        amount: parseFloat(match[1]),
        description: match[2].trim()
      };
    }
  }

  return null;
}

// Rota para receber mensagens do Twilio
app.post('/webhook', async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const userMessage = req.body.Body;
  const userId = req.body.From;

  const expenseData = extractExpenseData(userMessage);

  if (expenseData) {
    const { amount, description } = expenseData;
    const newExpense = new Expense({ userId, amount, description });
    await newExpense.save();

    const totalExpenses = await Expense.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const total = totalExpenses.length > 0 ? totalExpenses[0].total : 0;
    twiml.message(`Gasto de ${amount} reais com ${description} registrado. Total gasto: ${total} reais.`);
  } else {
    twiml.message(
      'Formato inválido. Use um dos seguintes formatos:\n\n' +
      '- "Gastei (valor) reais com (descrição do gasto)"\n' +
      '- "(valor) (descrição do gasto)"\n' +
      '- "(valor) com (descrição do gasto)"\n' +
      '- "(valor) em (descrição do gasto"\n\n' +
      'Exemplo: "Gastei 20 reais com Açai" ou "20 Açai"'
    );
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
