import express from "express";
import twilio from "twilio";
import { devLog } from "../helpers/logger.js";
import User from "../models/User.js";

import { interpretMessageWithAI } from "../services/aiService.js";
import {
  calculateTotalExpenses,
  calculateTotalIncome,
  getExpensesReport,
  getCategoryReport,
  getTotalReminders,
  getExpenseDetails,
  getIncomeDetails,
  getOrCreateCategory,
  getOrCreatePaymentMethod,
} from "../helpers/totalUtils.js";
import {
  generateChart,
  generateCategoryChart,
} from "../services/chartService.js";
// sendReportImage não está sendo usado, pode ser removido se desejar
// import { sendReportImage } from "../services/twilioService.js";
import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
import UserStats from "../models/UserStats.js";
// Permissions não está sendo usado, pode ser removido se desejar
// import Permissions from "../models/Permissions.js";
import { customAlphabet } from "nanoid";
import {
  sendGreetingMessage,
  sendHelpMessage,
  sendIncomeAddedMessage,
  sendExpenseAddedMessage,
  sendIncomeDeletedMessage,
  sendExpenseDeletedMessage,
  sendFinancialHelpMessage,
  sendReminderMessage,
  sendTotalRemindersMessage,
  sendReminderDeletedMessage,
} from "../helpers/messages.js";
import {
  VALID_CATEGORIES,
  VALID_CATEGORIES_INCOME,
} from "../utils/constants.js";
import { hasAccessToFeature } from "../helpers/userUtils.js";
import Reminder from "../models/Reminder.js";
import { fixPhoneNumber } from "../utils/phoneUtils.js";
import { validateUserAccess } from "../services/userAccessService.js";

const router = express.Router();

let conversationState = {};

router.post("/", async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const userMessage = req.body.Body;
  // << MUDANÇA: Renomeado para maior clareza
  const userPhoneNumber = fixPhoneNumber(req.body.From);

  console.log(userPhoneNumber);

  // Check if user exists in database
  const { authorized, user } = await validateUserAccess(userPhoneNumber); // << MUDANÇA

  if (!authorized) {
    twiml.message(
      "🔒 Para utilizar o chatbot, você precisa adquirir o produto primeiro. Acesse: https://www.adapfinanceira.com.br/"
    );
    res.writeHead(200, { "Content-Type": "text/xml" });
    return res.end(twiml.toString());
  }

  // << MUDANÇA: Esta será a nossa principal variável para o ID do usuário no DB
  const userDbId = user._id.toString();
  devLog(`User DB ID: ${userDbId}`);

  const previousData = conversationState[userDbId] || {}; // << MUDANÇA: Usar o ID do DB para o estado
  const userStats = await UserStats.findOne(
    { userId: userDbId },
    { blocked: 1 }
  ); // << MUDANÇA

  if (userStats?.blocked) {
    twiml.message("🚫 Você está bloqueado de usar a ADAP.");
    res.writeHead(200, { "Content-Type": "text/xml" });
    return res.end(twiml.toString());
  }

  const generateId = customAlphabet("1234567890abcdef", 5);

  try {
    const interpretation = await interpretMessageWithAI(userMessage);
    const userHasFreeCategorization = await hasAccessToFeature(
      userDbId,
      "categories"
    ); // << MUDANÇA
    devLog("intent:" + interpretation.intent);

    conversationState[userDbId] = { ...previousData, ...interpretation.data }; // << MUDANÇA

    switch (interpretation.intent) {
      // ... (outros cases)

      // EXEMPLO DE MUDANÇA EM UM CASE:
      case "add_income": {
        const { amount, description, category } = interpretation.data;
        devLog(amount, description, category);

        let finalCategoryName = category || "outro";
        if (
          !VALID_CATEGORIES_INCOME.includes(finalCategoryName) &&
          !userHasFreeCategorization
        ) {
          finalCategoryName = "outro";
        }

        const categoryDoc = await getOrCreateCategory(
          userDbId,
          finalCategoryName
        ); // << MUDANÇA

        const paymentMethodDoc = await getOrCreatePaymentMethod("pix");

        const newIncome = new Transaction({
          userId: userDbId, // << MUDANÇA
          amount,
          description,
          categoryId: categoryDoc._id.toString(),
          type: "income",
          date: new Date(),
          messageId: generateId(),
          paymentMethodId: paymentMethodDoc._id.toString(),
          status: "completed",
        });

        await newIncome.save();
        sendIncomeAddedMessage(twiml, {
          ...newIncome.toObject(),
          category: categoryDoc.name,
        });
        await UserStats.findOneAndUpdate(
          { userId: userDbId },
          { $inc: { totalIncome: amount } },
          { upsert: true }
        ); // << MUDANÇA

        break;
      }

      case "add_expense": {
        const { amount, description, category } = interpretation.data;
        devLog(amount, description, category);

        let finalCategoryName = category || "outro";
        if (
          !VALID_CATEGORIES.includes(finalCategoryName) &&
          !userHasFreeCategorization
        ) {
          finalCategoryName = "outro";
        }

        const categoryDoc = await getOrCreateCategory(
          userDbId,
          finalCategoryName
        ); // << MUDANÇA

        const paymentMethodDoc = await getOrCreatePaymentMethod("pix");

        const newExpense = new Transaction({
          userId: userDbId, // << MUDANÇA
          amount,
          description,
          categoryId: categoryDoc._id.toString(),
          type: "expense",
          date: new Date(),
          messageId: generateId(),
          paymentMethodId: paymentMethodDoc._id.toString(),
          status: "completed",
        });

        await newExpense.save();
        devLog("Salvando nova despesa:", newExpense);
        sendExpenseAddedMessage(twiml, {
          ...newExpense.toObject(),
          category: categoryDoc.name,
        });
        await UserStats.findOneAndUpdate(
          { userId: userDbId },
          { $inc: { totalSpent: amount } },
          { upsert: true }
        ); // << MUDANÇA

        break;
      }

      case "add_transaction_new_category": {
        const {
          amount: newAmount,
          description: newDescription,
          category: newCategory,
          type: newType,
        } = interpretation.data;
        devLog(
          `Nova transação com categoria custom: ${newAmount}, ${newDescription}, ${newCategory}, ${newType}`
        );

        if (!userHasFreeCategorization) {
          twiml.message(
            "🚫 Este recurso está disponível como um complemento pago.\n\n" +
              "🤖 Com ele, você poderá criar novas categorias personalizadas!\n\n" +
              'Por exemplo, criar a categoria "Transporte" para registrar gastos com Uber e gasolina, ou "Fast-food" para acompanhar o quanto está indo para aquele lanche que você merece... 🍔\n\n' +
              'Você também pode criar uma categoria como "Filho" para controlar os gastos com seu pequeno! 👶\n\n' +
              "📌 Acesse o link para testar agora mesmo: https://pay.hotmart.com/O99171246D?bid=1746998583184\n\n" +
              "Caso prefira, pode usar uma das 5 categorias grátis:\n" +
              "- gastos fixos\n" +
              "- lazer\n" +
              "- investimento\n" +
              "- conhecimento\n" +
              "- doação\n\n" +
              "✅ E agora também é possível registrar receitas!\n" +
              'Basta adicionar "Recebi" antes do valor.\n\n' +
              "É muito simples:\n\n" +
              "- Para despesa:\n" +
              "(Valor) (Onde) em (Categoria)\n" +
              "Exemplo:\n" +
              "25 mercado em gastos fixos\n\n" +
              "- Para receita:\n" +
              "Recebi (Valor) (De onde) em (Categoria)\n" +
              "Exemplo:\n" +
              "Recebi 1500 salário em investimento\n\n" +
              "Assim, você terá controle total sobre entradas e saídas de dinheiro!"
          );
          break;
        }

        if (!newCategory || !newType) {
          twiml.message(
            "🚫 Não consegui identificar a categoria ou o tipo (receita/despesa). Tente novamente."
          );
          break;
        }

        const categoryDoc = await getOrCreateCategory(userDbId, newCategory); // << MUDANÇA
        const paymentMethodDoc = await getOrCreatePaymentMethod("pix");
        const newTransaction = new Transaction({
          userId: userDbId, // << MUDANÇA
          amount: newAmount,
          description: newDescription,
          categoryId: categoryDoc._id.toString(),
          type: newType,
          date: new Date(),
          messageId: generateId(),
          paymentMethodId: paymentMethodDoc._id.toString(),
          status: "completed",
        });

        await newTransaction.save();
        devLog(`Nova transação (${newType}) salva:`, newTransaction);

        if (newType === "income") {
          sendIncomeAddedMessage(twiml, {
            ...newTransaction.toObject(),
            category: categoryDoc.name,
          });
          await UserStats.findOneAndUpdate(
            { userId: userDbId },
            { $inc: { totalIncome: newAmount } },
            { upsert: true }
          ); // << MUDANÇA
        } else {
          sendExpenseAddedMessage(twiml, {
            ...newTransaction.toObject(),
            category: categoryDoc.name,
          });
          await UserStats.findOneAndUpdate(
            { userId: userDbId },
            { $inc: { totalSpent: newAmount } },
            { upsert: true }
          ); // << MUDANÇA
        }

        break;
      }

      case "delete_transaction": {
        const { messageId } = interpretation.data;
        // << MUDANÇA: Usar userDbId em todas as queries
        const transaction = await Transaction.findOne({
          userId: userDbId,
          messageId,
        });
        if (!transaction) {
          twiml.message(
            `🚫 Nenhuma transação encontrada com o ID #_${messageId}_ para exclusão.`
          );
          break;
        }

        const category = await Category.findById(transaction.categoryId);
        await Transaction.findOneAndDelete({ userId: userDbId, messageId });

        if (transaction.type === "income") {
          await UserStats.findOneAndUpdate(
            { userId: userDbId },
            { $inc: { totalIncome: -transaction.amount } }
          );
          sendIncomeDeletedMessage(twiml, {
            ...transaction.toObject(),
            category: category.name,
          });
        } else {
          await UserStats.findOneAndUpdate(
            { userId: userDbId },
            { $inc: { totalSpent: -transaction.amount } }
          );

          const isCustomCategory =
            !VALID_CATEGORIES.includes(category.name) &&
            !VALID_CATEGORIES_INCOME.includes(category.name);
          if (isCustomCategory) {
            const count = await Transaction.countDocuments({
              userId: userDbId,
              categoryId: category._id.toString(),
            });
            if (count === 0) {
              await Category.findByIdAndDelete(category._id);
            }
          }
          sendExpenseDeletedMessage(twiml, {
            ...transaction.toObject(),
            category: category.name,
          });
        }
        break;
      }

      case "generate_daily_chart": {
        const { days = 7 } = interpretation.data;
        const daysToRequest = parseInt(days, 10);
        const reportData = await getExpensesReport(userDbId, daysToRequest); // << MUDANÇA
        // ... resto da lógica
        if (reportData.length === 0) {
          twiml.message(
            `📉 Não há registros de gastos nos últimos ${daysToRequest} dias.`
          );
        } else {
          const imageUrl = await generateChart(
            reportData,
            userDbId,
            daysToRequest
          );
          twiml.message().media(imageUrl);
        }
        break;
      }

      case "generate_category_chart": {
        const { days = 30 } = interpretation.data;
        const categoryReport = await getCategoryReport(userDbId, days); // << MUDANÇA
        // ... resto da lógica
        if (categoryReport.length === 0) {
          twiml.message(
            `📊 Não há registros de gastos nos últimos ${days} dias para gerar um relatório por categoria.`
          );
        } else {
          const imageUrl = await generateCategoryChart(
            categoryReport,
            userDbId
          );
          twiml.message().media(imageUrl);
        }
        break;
      }

      case "get_total": {
        let { category, month, monthName } = interpretation.data;

        // Garante que sempre temos um mês e nome de mês válidos
        if (!month || !monthName) {
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
          month = `${currentYear}-${currentMonth}`;
          const monthNameRaw = now.toLocaleString("pt-BR", { month: "long" });
          monthName =
            monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1);
        }

        const total = await calculateTotalExpenses(userDbId, category, month);

        // << MUDANÇA PRINCIPAL: Trata o caso de total zero separadamente >>
        if (total === 0) {
          let zeroMessage;
          if (category) {
            const catFormatted =
              category.charAt(0).toUpperCase() + category.slice(1);
            zeroMessage = `🎉 Você não tem gastos na categoria _*${catFormatted}*_ no mês de _*${monthName}*_.`;
          } else {
            zeroMessage = `🎉 Você não tem gastos registrados no mês de _*${monthName}*_.`;
          }
          twiml.message(zeroMessage);
        } else {
          // Se total > 0, fazemos a lógica completa
          let responseMessage;
          if (category) {
            const catFormatted =
              category.charAt(0).toUpperCase() + category.slice(1);
            responseMessage = `📉 *Gasto total* em _*${catFormatted}*_ no mês de _*${monthName}*_: \nR$ ${total.toFixed(
              2
            )}`;
          } else {
            responseMessage = `📉 *Gasto total* no mês de _*${monthName}*_: \nR$ ${total.toFixed(
              2
            )}`;
          }

          responseMessage += `.\n\nDigite "detalhes" para ver a lista de itens.`;
          conversationState[userDbId] = {
            type: "expense",
            category,
            month,
            monthName,
          };
          twiml.message(responseMessage);
        }

        break;
      }

      case "get_total_income": {
        let { category, month, monthName } = interpretation.data;

        // Garante que sempre temos um mês e nome de mês válidos
        if (!month || !monthName) {
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
          month = `${currentYear}-${currentMonth}`;
          const monthNameRaw = now.toLocaleString("pt-BR", { month: "long" });
          monthName =
            monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1);
        }

        const totalIncome = await calculateTotalIncome(
          userDbId,
          month,
          category
        );

        // << MUDANÇA PRINCIPAL: Trata o caso de total zero separadamente >>
        if (totalIncome === 0) {
          let zeroMessage;
          if (category) {
            const catFormatted =
              category.charAt(0).toUpperCase() + category.slice(1);
            zeroMessage = `🤷‍♀️ Nenhuma receita registrada na categoria _*${catFormatted}*_ no mês de _*${monthName}*_.`;
          } else {
            zeroMessage = `🤷‍♀️ Nenhuma receita registrada no mês de _*${monthName}*_.`;
          }
          twiml.message(zeroMessage);
        } else {
          // Se total > 0, fazemos a lógica completa
          let responseMessage;
          if (category) {
            const catFormatted =
              category.charAt(0).toUpperCase() + category.slice(1);
            responseMessage = `📈 *Receita total* de _*${catFormatted}*_ no mês de _*${monthName}*_: \nR$ ${totalIncome.toFixed(
              2
            )}`;
          } else {
            responseMessage = `📈 *Receita total* no mês de _*${monthName}*_: \nR$ ${totalIncome.toFixed(
              2
            )}`;
          }

          responseMessage += `.\n\nDigite "detalhes" para ver a lista de itens.`;
          conversationState[userDbId] = {
            type: "income",
            category,
            month,
            monthName,
          };
          twiml.message(responseMessage);
        }

        break;
      }

      case "detalhes": {
        const previousData = conversationState[userDbId]; // << MUDANÇA
        // ...
        const { type, category, month, monthName } = previousData;
        let detalhesMessage;
        if (type === "income") {
          detalhesMessage = await getIncomeDetails(
            userDbId,
            month,
            monthName,
            category
          ); // << MUDANÇA
        } else {
          detalhesMessage = await getExpenseDetails(
            userDbId,
            month,
            monthName,
            category
          ); // << MUDANÇA
        }
        twiml.message(detalhesMessage);
        delete conversationState[userDbId]; // << MUDANÇA
        break;
      }

      // ... (outros cases, como greeting e financial_help não precisam de mudança)

      case "reminder": {
        const { description, date } = interpretation.data;
        const newReminder = new Reminder({
          userId: userDbId, // << MUDANÇA
          description: description,
          date: date,
          messageId: generateId(),
        });
        await newReminder.save();
        await sendReminderMessage(twiml, userMessage, newReminder);
        break;
      }

      case "delete_reminder": {
        const { messageId } = interpretation.data;
        // << MUDANÇA: Usar userDbId em todas as queries
        const reminder = await Reminder.findOneAndDelete({
          userId: userDbId,
          messageId,
        });
        if (reminder) {
          sendReminderDeletedMessage(twiml, reminder);
        }
        break;
      }

      case "get_total_reminders": {
        const totalReminders = await getTotalReminders(userDbId); // << MUDANÇA
        sendTotalRemindersMessage(twiml, totalReminders);
        break;
      }

      case "financial_help": {
        if (!(await hasAccessToFeature(userDbId, "adap-turbo"))) {
          // << MUDANÇA
          twiml.message(
            "🚫 Este recurso está disponível como um complemento pago. (...)"
          );
          break;
        }
        await sendFinancialHelpMessage(twiml, userMessage);
        break;
      }

      case "greeting": {
        sendGreetingMessage(twiml);
        break;
      }

      default:
        sendHelpMessage(twiml);
        break;
    }
  } catch (err) {
    devLog("Erro ao interpretar a mensagem:", err);
    sendHelpMessage(twiml);
  }

  devLog("Resposta final do Twilio:", twiml.toString());
  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
});

export default router;
