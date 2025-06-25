import express from "express";
import twilio from "twilio";
import { sendTextMessage, sendTextMessageTEST } from "../services/twilioService.js";
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
} from "../helpers/totalUtils.js";
import {
  generateChart,
  generateCategoryChart,
} from "../services/chartService.js";
import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
import UserStats from "../models/UserStats.js";
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
  const userPhoneNumber = fixPhoneNumber(req.body.From);

  // --- 1. INICIALIZE A FLAG AQUI ---
  let responseHasBeenSent = false;

  console.log(userPhoneNumber);

  const { authorized, user } = await validateUserAccess(userPhoneNumber);

  if (!authorized) {
    twiml.message(
      "🔒 Para utilizar o chatbot, você precisa adquirir o produto primeiro. Acesse: https://seusite.com/comprar"
    );
    // Note: Não estamos enviando a resposta aqui ainda, apenas preparando.
  } else {
    const userDbId = user._id.toString();
    devLog(`User DB ID: ${userDbId}`);

    const previousData = conversationState[userDbId] || {};
    const userStats = await UserStats.findOne(
      { userId: userDbId },
      { blocked: 1 }
    );

    if (userStats?.blocked) {
      twiml.message("🚫 Você está bloqueado de usar a ADAP.");
    } else {
      const generateId = customAlphabet("1234567890abcdef", 5);

      try {
        const interpretation = await interpretMessageWithAI(userMessage);
        const userHasFreeCategorization = await hasAccessToFeature(
          userDbId,
          "categories"
        );
        devLog("intent:" + interpretation.intent);

        conversationState[userDbId] = {
          ...previousData,
          ...interpretation.data,
        };

        switch (interpretation.intent) {
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
            );

            const newIncome = new Transaction({
              userId: userDbId,
              amount,
              description,
              categoryId: categoryDoc._id.toString(),
              type: "income",
              date: new Date(),
              messageId: generateId(),
              paymentMethod: "default",
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
            );

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
            );

            const newExpense = new Transaction({
              userId: userDbId,
              amount,
              description,
              categoryId: categoryDoc._id.toString(),
              type: "expense",
              date: new Date(),
              messageId: generateId(),
              paymentMethod: "default",
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
            );

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

            const categoryDoc = await getOrCreateCategory(
              userDbId,
              newCategory
            );
            const newTransaction = new Transaction({
              userId: userDbId,
              amount: newAmount,
              description: newDescription,
              categoryId: categoryDoc._id.toString(),
              type: newType,
              date: new Date(),
              messageId: generateId(),
              paymentMethod: "default",
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
              );
            } else {
              sendExpenseAddedMessage(twiml, {
                ...newTransaction.toObject(),
                category: categoryDoc.name,
              });
              await UserStats.findOneAndUpdate(
                { userId: userDbId },
                { $inc: { totalSpent: newAmount } },
                { upsert: true }
              );
            }

            break;
          }

          case "delete_transaction": {
            const { messageId } = interpretation.data;
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
            const reportData = await getExpensesReport(userDbId, daysToRequest);
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
            const categoryReport = await getCategoryReport(userDbId, days);
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

            if (!month || !monthName) {
              const now = new Date();
              const currentYear = now.getFullYear();
              const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
              month = `${currentYear}-${currentMonth}`;
              const monthNameRaw = now.toLocaleString("pt-BR", {
                month: "long",
              });
              monthName =
                monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1);
            }

            const total = await calculateTotalExpenses(
              userDbId,
              category,
              month
            );

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

            if (!month || !monthName) {
              const now = new Date();
              const currentYear = now.getFullYear();
              const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
              month = `${currentYear}-${currentMonth}`;
              const monthNameRaw = now.toLocaleString("pt-BR", {
                month: "long",
              });
              monthName =
                monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1);
            }

            const totalIncome = await calculateTotalIncome(
              userDbId,
              month,
              category
            );

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
            const previousData = conversationState[userDbId];
            const { type, category, month, monthName } = previousData;

            let messageChunks = [];
            if (type === "income") {
              messageChunks = await getIncomeDetails(
                userDbId,
                month,
                monthName,
                category
              );
            } else {
              messageChunks = await getExpenseDetails(
                userDbId,
                month,
                monthName,
                category
              );
            }

            const sendSequentially = async () => {
              try {
                for (const chunk of messageChunks) {
                  await sendTextMessage(req.body.From, chunk);
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }
              } catch (error) {
                devLog("Erro no loop de envio sequencial:", error);
              }
            };

            // Dispara o envio em background
            sendSequentially();

            // Envia a resposta vazia imediatamente para o Twilio
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(new twilio.twiml.MessagingResponse().toString());

            // SINALIZA QUE A RESPOSTA FOI ENVIADA
            responseHasBeenSent = true;

            delete conversationState[userDbId];
            break; // O break é suficiente aqui
          }

          case "reminder": {
            const { description, date } = interpretation.data;
            const newReminder = new Reminder({
              userId: userDbId,
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
            const totalReminders = await getTotalReminders(userDbId);
            sendTotalRemindersMessage(twiml, totalReminders);
            break;
          }

          case "financial_help": {
            if (!(await hasAccessToFeature(userDbId, "adap-turbo"))) {
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
    }
  }
  if (!responseHasBeenSent) {
    devLog("Resposta final do Twilio:", twiml.toString());
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
  }
});

export default router;
