import express from "express";
import twilio from "twilio";
import { devLog } from "../helpers/logger.js";

import { interpretMessageWithAI } from "../services/aiService.js";
import {
  calculateTotalExpenses,
  getCurrentTotalIncome,
  getExpensesReport,
  getCategoryReport,
  getCurrentTotalSpent,
  getTotalReminders,
} from "../helpers/totalUtils.js";
import {
  generateChart,
  generateCategoryChart,
} from "../services/chartService.js";
import { sendReportImage } from "../services/twilioService.js";
import Expense from "../models/Expense.js";
import Income from "../models/Income.js";
import UserStats from "../models/UserStats.js";
import { customAlphabet } from "nanoid";
import {
  sendGreetingMessage,
  sendHelpMessage,
  sendIncomeAddedMessage,
  sendExpenseAddedMessage,
  sendIncomeDeletedMessage,
  sendExpenseDeletedMessage,
  sendTotalIncomeMessage,
  sendTotalExpensesMessage,
  sendTotalExpensesAllMessage,
  sendFinancialHelpMessage,
  sendReminderMessage,
  sendTotalRemindersMessage,
  sendReminderDeletedMessage,
  sendTotalExpensesLastMonthsMessage,
} from "../helpers/messages.js";
import {
  VALID_CATEGORIES,
  VALID_CATEGORIES_INCOME,
} from "../utils/constants.js";
import { hasAcessToFeature } from "../helpers/userUtils.js";
import Reminder from "../models/Reminder.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const userMessage = req.body.Body;
  const userId = req.body.From;

  const userStats = await UserStats.findOne({ userId }, { blocked: 1 });

  if (userStats?.blocked) {
    twiml.message("🚫 Você está bloqueado de usar a ADAP.");
    res.writeHead(200, { "Content-Type": "text/xml" });
    return res.end(twiml.toString());
  }

  const generateId = customAlphabet("1234567890abcdef", 5);

  try {
    const interpretation = await interpretMessageWithAI(userMessage);
    const userHasFreeCategorization = await hasAcessToFeature(
      userId,
      "add_expense_new_category"
    );
    devLog(interpretation.intent);

    switch (interpretation.intent) {
      case "add_income": {
        const { amount, description, category, messageId } =
          interpretation.data;
        devLog(amount, description, category);

        let finalCategory = category || "outro";
        if (
          !VALID_CATEGORIES_INCOME.includes(finalCategory) &&
          !userHasFreeCategorization
        ) {
          finalCategory = "outro";
        }

        if (
          VALID_CATEGORIES_INCOME.includes(finalCategory) &&
          !userHasFreeCategorization
        ) {
          const newIncome = new Income({
            userId,
            amount,
            description,
            category: finalCategory,
            date: new Date(),
            messageId: generateId(),
          });
          devLog("Salvando nova receita:", newIncome);
          await newIncome.save();
          devLog("Enviando mensagem de confirmação ao usuário.");
          sendIncomeAddedMessage(twiml, newIncome);
          await UserStats.findOneAndUpdate(
            { userId },
            { $inc: { totalIncome: amount } },
            { upsert: true }
          );
        } else {
          const regex = new RegExp(description, "i");

          const similarIncome = await Income.findOne({
            userId,
            description: { $regex: regex },
          }).sort({ date: -1 });

          if (userHasFreeCategorization && similarIncome?.category) {
            const inferredIncome = similarIncome.category;

            const newIncome = new Income({
              userId,
              amount,
              description,
              category: inferredIncome,
              date: new Date(),
              messageId: generateId(),
            });
            devLog("Salvando nova receita:", newIncome);
            await newIncome.save();
            devLog("Enviando mensagem de confirmação ao usuário.");
            sendIncomeAddedMessage(twiml, newIncome);
            await UserStats.findOneAndUpdate(
              { userId },
              { $inc: { totalIncome: amount } },
              { upsert: true }
            );
          } else {
            const newIncome = new Income({
              userId,
              amount,
              description,
              category: finalCategory,
              date: new Date(),
              messageId: generateId(),
            });
            devLog("Salvando nova receita:", newIncome);
            await newIncome.save();
            devLog("Enviando mensagem de confirmação ao usuário.");
            sendIncomeAddedMessage(twiml, newIncome);
            await UserStats.findOneAndUpdate(
              { userId },
              { $inc: { totalIncome: amount } },
              { upsert: true }
            );
          }
        }
        break;
      }

      case "add_expense":
        {
          const { amount, description, category, messageId } =
            interpretation.data;
          devLog(amount, description, category);
          devLog(
            "Verificando se categoria é válida e acesso a categoria customizada..."
          );

          let finalCategory = category;
          if (!VALID_CATEGORIES.includes(finalCategory)) {
            finalCategory = "outro";
          }

          if (
            VALID_CATEGORIES.includes(category) &&
            !userHasFreeCategorization
          ) {
            const newExpense = new Expense({
              userId,
              amount,
              description,
              category: finalCategory,
              date: new Date(),
              messageId: generateId(),
            });
            devLog("Salvando nova despesa:", newExpense);
            await newExpense.save();
            devLog("Enviando mensagem de confirmação ao usuário.");
            sendExpenseAddedMessage(twiml, newExpense);
            await UserStats.findOneAndUpdate(
              { userId },
              { $inc: { totalSpent: amount } },
              { upsert: true }
            );
          } else {
            const regex = new RegExp(description, "i");

            const similarExpense = await Expense.findOne({
              userId,
              description: { $regex: regex },
            }).sort({ date: -1 });

            if (userHasFreeCategorization && similarExpense?.category) {
              const inferredCategory = similarExpense.category;

              const newExpense = new Expense({
                userId,
                amount,
                description,
                category: inferredCategory,
                date: new Date(),
                messageId: generateId(),
              });
              devLog("Salvando nova despesa:", newExpense);
              await newExpense.save();
              devLog("Enviando mensagem de confirmação ao usuário.");
              sendExpenseAddedMessage(twiml, newExpense);
              await UserStats.findOneAndUpdate(
                { userId },
                { $inc: { totalSpent: amount } },
                { upsert: true }
              );
            } else {
              const newExpense = new Expense({
                userId,
                amount,
                description,
                category: finalCategory,
                date: new Date(),
                messageId: generateId(),
              });
              devLog("Salvando nova despesa:", newExpense);
              await newExpense.save();
              devLog("Enviando mensagem de confirmação ao usuário.");
              sendExpenseAddedMessage(twiml, newExpense);
              await UserStats.findOneAndUpdate(
                { userId },
                { $inc: { totalSpent: amount } },
                { upsert: true }
              );
            }
          }
        }
        break;

      case "add_expense_new_category": {
        const {
          amount: newAmount,
          description: newDescription,
          category: newCategory,
          type: newType,
          messageId,
        } = interpretation.data;
        devLog(newAmount, newDescription, newCategory, newType);
        if (!(await hasAcessToFeature(userId, "add_expense_new_category"))) {
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
              "- doação\n" +
              "- outro\n\n" +
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

        if (newType === "income") {
          if (!newCategory) {
            devLog("Erro: Categoria não informada. Abortando.");
            twiml.message(
              "🚫 Não consegui identificar a categoria. Tente novamente."
            );
            break;
          }

          if (!VALID_CATEGORIES_INCOME.includes(newCategory)) {
            await UserStats.findOneAndUpdate(
              { userId },
              { $addToSet: { createdCategories: newCategory } },
              { new: true, upsert: true }
            );
          }
          console.log("Categoria:", newCategory);
          const newIncome = new Income({
            userId,
            amount: newAmount,
            description: newDescription,
            category: newCategory,
            date: new Date(),
            messageId: generateId(),
          });
          devLog("Salvando nova receita:", newIncome);
          await newIncome.save();
          devLog("Enviando mensagem de confirmação ao usuário.");
          sendIncomeAddedMessage(twiml, newIncome);
          await UserStats.findOneAndUpdate(
            { userId },
            { $inc: { totalIncome: newAmount } },
            { upsert: true }
          );
          break;
        } else if (newType === "expense") {
          if (!VALID_CATEGORIES.includes(newCategory)) {
            await UserStats.findOneAndUpdate(
              { userId },
              { $addToSet: { createdCategories: newCategory } },
              { new: true, upsert: true }
            );

            const newExpense = new Expense({
              userId,
              amount: newAmount,
              description: newDescription,
              category: newCategory,
              date: new Date(),
              messageId: generateId(),
            });
            devLog("Salvando nova despesa:", newExpense);
            await newExpense.save();
            devLog("Enviando mensagem de confirmação ao usuário.");
            sendExpenseAddedMessage(twiml, newExpense);
            await UserStats.findOneAndUpdate(
              { userId },
              { $inc: { totalSpent: newAmount } },
              { upsert: true }
            );
          } else {
            sendHelpMessage(twiml);
          }
          break;
        }
      }

      case "delete_transaction":
        {
          const { messageId } = interpretation.data;
          try {
            const isIncome = await Income.findOne({ userId, messageId });

            if (isIncome) {
              const income = await Income.findOneAndDelete({
                userId,
                messageId,
              });

              if (income) {
                await UserStats.findOneAndUpdate(
                  { userId },
                  { $inc: { totalIncome: -income.amount } }
                );
              }

              sendIncomeDeletedMessage(twiml, income);
              break;
            }

            const expense = await Expense.findOneAndDelete({
              userId,
              messageId,
            });

            if (expense) {
              const isCustomCategory = !VALID_CATEGORIES.includes(
                expense.category
              );

              if (isCustomCategory) {
                const count = await Expense.countDocuments({
                  userId,
                  category: expense.category,
                });
                if (count === 0) {
                  await UserStats.findOneAndUpdate(
                    { userId },
                    { $pull: { createdCategories: expense.category } }
                  );
                }
              }

              sendExpenseDeletedMessage(twiml, expense);
              await UserStats.findOneAndUpdate(
                { userId },
                { $inc: { totalSpent: -expense.amount } }
              );
            } else {
              twiml.message(
                `🚫 Nenhum gasto encontrado com o ID #_${messageId}_ para exclusão.`
              );
            }
          } catch (error) {
            devLog("Erro ao excluir despesa pelo messageId:", error);
            twiml.message(
              "🚫 Ocorreu um erro ao tentar excluir a despesa. Tente novamente."
            );
          }
        }
        break;

      case "generate_daily_chart":
        {
          const { days = 7 } = interpretation.data;
          try {
            const reportData = await getExpensesReport(userId, days);

            if (reportData.length === 0) {
              twiml.message(
                `📉 Não há registros de gastos nos últimos ${days} dias.`
              );
            } else {
              const imageUrl = await generateChart(reportData, userId);
              await sendReportImage(userId, imageUrl);
            }
          } catch (error) {
            devLog("Erro ao gerar gráfico:", error);
            twiml.message(
              "❌ Ocorreu um erro ao gerar o relatório. Tente novamente."
            );
          }
        }
        break;

      case "generate_category_chart":
        {
          const { days = 30 } = interpretation.data;
          try {
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
            devLog("Erro ao gerar gráfico por categorias:", error);
            twiml.message(
              "❌ Ocorreu um erro ao gerar o relatório por categorias. Tente novamente."
            );
          }
        }
        break;

      case "get_total":
        {
          const { category, type } = interpretation.data;
          console.log("Tipo:", type, "Categoria:", category);
          const total = await calculateTotalExpenses(userId, category, type);
          sendTotalExpensesMessage(twiml, total, category, type);
        }
        break;

      case "get_total_income":
        const totalIncome = await getCurrentTotalIncome(userId);
        sendTotalIncomeMessage(twiml, totalIncome);
        break;

      case "get_total_all":
        const totalAll = await getCurrentTotalSpent(userId);
        sendTotalExpensesAllMessage(twiml, totalAll);
        break;

      case "get_total_last_months":
        {
          const { monthName, month: interpretationDataMonth } =
            interpretation.data;
          const getCurrentMonthFormatted = () => {
            const date = new Date();
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            return `${year}-${month}`;
          };

          const currentMonth = getCurrentMonthFormatted();

          if (
            interpretationDataMonth < "2025-01" ||
            interpretationDataMonth > currentMonth
          ) {
            twiml.message("🚫 Mês inválido. Tente novamente.");
            break;
          } else {
            const spendingHistoryLastMonths = await UserStats.aggregate([
              { $match: { userId } },
              { $unwind: "$spendingHistory" },
              { $match: { "spendingHistory.month": interpretationDataMonth } },
              {
                $group: {
                  _id: null,
                  total: { $sum: "$spendingHistory.amount" },
                },
              },
            ]);

            sendTotalExpensesLastMonthsMessage(
              twiml,
              spendingHistoryLastMonths,
              monthName
            );
          }
        }
        break;

      case "greeting":
        sendGreetingMessage(twiml);
        break;

      case "reminder":
        const { description, date } = interpretation.data;

        const newReminder = new Reminder({
          userId,
          description: description,
          date: date,
          messageId: generateId(),
        });

        await newReminder.save();

        await sendReminderMessage(twiml, userMessage, newReminder);
        break;

      case "delete_reminder":
        const { messageId } = interpretation.data;

        try {
          const isReminder = await Reminder.findOne({ userId, messageId });

          if (isReminder) {
            const reminder = await Reminder.findOneAndDelete({
              userId,
              messageId,
            });
            sendReminderDeletedMessage(twiml, reminder);
          }
        } catch (error) {
          devLog("Erro ao excluir lembrete pelo messageId:", error);
          twiml.message(
            "🚫 Ocorreu um erro ao tentar excluir o lembrete. Tente novamente."
          );
        }

        break;

      case "get_total_reminders":
        const totalReminders = await getTotalReminders(userId);
        sendTotalRemindersMessage(twiml, totalReminders);
        break;

      case "financial_help":
        if (!(await hasAcessToFeature(userId, "financial_help"))) {
          twiml.message(
            "🚫 Este recurso está disponível como um complemento pago. Com ele você pode pedir coneselhos financeiros ou de investimentos. Acesse o site para ativar: https://pay.hotmart.com/S98803486L?bid=1746998755631"
          );
          break;
        }
        await sendFinancialHelpMessage(twiml, userMessage);
        break;

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
