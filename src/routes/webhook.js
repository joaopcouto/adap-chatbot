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
} from "../helpers/totalUtils.js";
import {
  generateChart,
  generateCategoryChart,
} from "../services/chartService.js";
import { sendReportImage } from "../services/twilioService.js";
import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
import UserStats from "../models/UserStats.js";
import Permissions from "../models/Permissions.js";
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
  const userId = fixPhoneNumber(req.body.From); // Remove 'whatsapp:+' prefix
    
  console.log(userId);

  // Check if user exists in database
 
  const { authorized, user } = await validateUserAccess(userId);

  if (!authorized) {
    twiml.message("🔒 Para utilizar o chatbot, você precisa adquirir o produto primeiro. Acesse: https://seusite.com/comprar");
    res.writeHead(200, { "Content-Type": "text/xml" });
    return res.end(twiml.toString());
  }

  const previousData = conversationState[userId];
  const userStats = await UserStats.findOne({ userId }, { blocked: 1 });

  if (userStats?.blocked) {
    twiml.message("🚫 Você está bloqueado de usar a ADAP.");
    res.writeHead(200, { "Content-Type": "text/xml" });
    return res.end(twiml.toString());
  }

  const generateId = customAlphabet("1234567890abcdef", 5);

  const userMongoId = await User.findOne({ phoneNumber: userId }, { _id: 1 });

  const userMongoIdString = userMongoId._id.toString();

  devLog(userMongoIdString)

  try {
    const interpretation = await interpretMessageWithAI(userMessage);
    const userHasFreeCategorization = await hasAccessToFeature(
      userMongoIdString,
      "categories"
    );
    devLog("intent:" + interpretation.intent);

    conversationState[userId] = { ...previousData, ...interpretation.data };

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

        // Get or create category
        const categoryDoc = await getOrCreateCategory(userId, finalCategory);

        if (
          VALID_CATEGORIES_INCOME.includes(finalCategory) &&
          !userHasFreeCategorization
        ) {
          const newIncome = new Transaction({
            userId,
            amount,
            description,
            categoryId: categoryDoc._id.toString(),
            type: "income",
            date: new Date(),
            messageId: generateId(),
            paymentMethod: "default",
            status: "completed",
          });
          devLog("Salvando nova receita:", newIncome);
          await newIncome.save();
          devLog("Enviando mensagem de confirmação ao usuário.");
          sendIncomeAddedMessage(twiml, { ...newIncome.toObject(), category: categoryDoc.name });
          await UserStats.findOneAndUpdate(
            { userId },
            { $inc: { totalIncome: amount } },
            { upsert: true }
          );
        } else {
          const regex = new RegExp(description, "i");

          const similarIncome = await Transaction.findOne({
            userId,
            type: "income",
            description: { $regex: regex },
          }).sort({ date: -1 });

                      if (userHasFreeCategorization && similarIncome?.categoryId) {
              const inferredCategory = await Category.findById(similarIncome.categoryId);

                          const newIncome = new Transaction({
                userId,
                amount,
                description,
                categoryId: inferredCategory._id.toString(),
                type: "income",
                date: new Date(),
                messageId: generateId(),
                paymentMethod: "default",
                status: "completed",
              });
              devLog("Salvando nova receita:", newIncome);
              await newIncome.save();
              devLog("Enviando mensagem de confirmação ao usuário.");
              sendIncomeAddedMessage(twiml, { ...newIncome.toObject(), category: inferredCategory.name });
            await UserStats.findOneAndUpdate(
              { userId },
              { $inc: { totalIncome: amount } },
              { upsert: true }
            );
          } else {
            const newIncome = new Transaction({
              userId,
              amount,
              description,
              categoryId: categoryDoc._id.toString(),
              type: "income",
              date: new Date(),
              messageId: generateId(),
              paymentMethod: "default",
              status: "completed",
            });
            devLog("Salvando nova receita:", newIncome);
            await newIncome.save();
            devLog("Enviando mensagem de confirmação ao usuário.");
            sendIncomeAddedMessage(twiml, { ...newIncome.toObject(), category: categoryDoc.name });
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

          // Get or create category
          const categoryDoc = await getOrCreateCategory(userId, finalCategory);

          if (
            VALID_CATEGORIES.includes(category) &&
            !userHasFreeCategorization
          ) {
            const newExpense = new Transaction({
              userId,
              amount,
              description,
              categoryId: categoryDoc._id.toString(),
              type: "expense",
              date: new Date(),
              messageId: generateId(),
              paymentMethod: "default",
              status: "completed",
            });
            devLog("Salvando nova despesa:", newExpense);
            await newExpense.save();
            devLog("Enviando mensagem de confirmação ao usuário.");
            sendExpenseAddedMessage(twiml, { ...newExpense.toObject(), category: categoryDoc.name });
            await UserStats.findOneAndUpdate(
              { userId },
              { $inc: { totalSpent: amount } },
              { upsert: true }
            );
          } else {
            const regex = new RegExp(description, "i");

            const similarExpense = await Transaction.findOne({
              userId,
              type: "expense",
              description: { $regex: regex },
            }).sort({ date: -1 });

            if (userHasFreeCategorization && similarExpense?.categoryId) {
              const inferredCategory = await Category.findById(similarExpense.categoryId);

              const newExpense = new Transaction({
                userId,
                amount,
                description,
                categoryId: inferredCategory._id.toString(),
                type: "expense",
                date: new Date(),
                messageId: generateId(),
                paymentMethod: "default",
                status: "completed",
              });
              devLog("Salvando nova despesa:", newExpense);
              await newExpense.save();
              devLog("Enviando mensagem de confirmação ao usuário.");
              sendExpenseAddedMessage(twiml, { ...newExpense.toObject(), category: inferredCategory.name });
              await UserStats.findOneAndUpdate(
                { userId },
                { $inc: { totalSpent: amount } },
                { upsert: true }
              );
            } else {
              const newExpense = new Transaction({
                userId,
                amount,
                description,
                categoryId: categoryDoc._id.toString(),
                type: "expense",
                date: new Date(),
                messageId: generateId(),
                paymentMethod: "default",
                status: "completed",
              });
              devLog("Salvando nova despesa:", newExpense);
              await newExpense.save();
              devLog("Enviando mensagem de confirmação ao usuário.");
              sendExpenseAddedMessage(twiml, { ...newExpense.toObject(), category: categoryDoc.name });
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
        if (!(await hasAccessToFeature(userMongoIdString
          , "categories"))) {
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

        if (newType === "income") {
          if (!newCategory) {
            devLog("Erro: Categoria não informada. Abortando.");
            twiml.message(
              "🚫 Não consegui identificar a categoria. Tente novamente."
            );
            break;
          }

          // Get or create category in the dedicated categories collection
          const categoryDoc = await getOrCreateCategory(userId, newCategory);

          console.log("Categoria:", newCategory);
          const newIncome = new Transaction({
            userId,
            amount: newAmount,
            description: newDescription,
            categoryId: categoryDoc._id.toString(),
            type: "income",
            date: new Date(),
            messageId: generateId(),
            paymentMethod: "default",
            status: "completed",
          });
          await newIncome.save();
          devLog("Enviando mensagem de confirmação ao usuário.");
          sendIncomeAddedMessage(twiml, { ...newIncome.toObject(), category: categoryDoc.name });
          await UserStats.findOneAndUpdate(
            { userId },
            { $inc: { totalIncome: amount } },
            { upsert: true }
          );
          break;
        } else if (newType === "expense") {
          // Get or create category in the dedicated categories collection
          const categoryDoc = await getOrCreateCategory(userId, newCategory);

          const newExpense = new Transaction({
            userId,
            amount: newAmount,
            description: newDescription,
            categoryId: categoryDoc._id.toString(),
            type: "expense",
            date: new Date(),
            messageId: generateId(),
            paymentMethod: "default",
            status: "completed",
          });
          devLog("Salvando nova despesa:", newExpense);
          await newExpense.save();
          devLog("Enviando mensagem de confirmação ao usuário.");
          sendExpenseAddedMessage(twiml, { ...newExpense.toObject(), category: categoryDoc.name });
          await UserStats.findOneAndUpdate(
            { userId },
            { $inc: { totalSpent: newAmount } },
            { upsert: true }
          );
          break;
        }
      }

      case "delete_transaction":
        {
          const { messageId } = interpretation.data;
          try {
            const transaction = await Transaction.findOne({ userId, messageId });
            if (!transaction) {
              twiml.message(
                `🚫 Nenhuma transação encontrada com o ID #_${messageId}_ para exclusão.`
              );
              break;
            }
            
            const category = await Category.findById(transaction.categoryId);

                          await Transaction.findOneAndDelete({
                userId,
                messageId,
              });

              // Update user stats based on transaction type
              if (transaction.type === "income") {
                await UserStats.findOneAndUpdate(
                  { userId },
                  { $inc: { totalIncome: -transaction.amount } }
                );
                sendIncomeDeletedMessage(twiml, { ...transaction.toObject(), category: category.name });
              } else {
                await UserStats.findOneAndUpdate(
                  { userId },
                  { $inc: { totalSpent: -transaction.amount } }
                );

                // Check if this was the last transaction using this category
                const categoryId = category._id;
                const categoryName = category.name;
                
                // Only check for custom categories (non-default ones)
                const isCustomCategory = !VALID_CATEGORIES.includes(categoryName) && !VALID_CATEGORIES_INCOME.includes(categoryName);

                if (isCustomCategory) {
                  const count = await Transaction.countDocuments({
                    userId,
                    categoryId: categoryId.toString(),
                  });
                  
                  // If no more transactions use this category, delete it
                  if (count === 0) {
                    await Category.findByIdAndDelete(categoryId);
                  }
                }

                sendExpenseDeletedMessage(twiml, { ...transaction.toObject(), category: category.name });
              }
          } catch (error) {
            devLog("Erro ao excluir transação pelo messageId:", error);
            twiml.message(
              "🚫 Ocorreu um erro ao tentar excluir a transação. Tente novamente."
            );
          }
        }
        break;

      case "generate_daily_chart":
        {
          const { days = 7 } = interpretation.data;
          try {
            const daysToRequest = parseInt(days, 10);
            const reportData = await getExpensesReport(userId, daysToRequest);

            if (reportData.length === 0 && daysToRequest <= 7) { 
              twiml.message(
                `📉 Não há registros de gastos nos últimos ${daysToRequest} dias.`
              );
            } else {
              const imageUrl = await generateChart(
                reportData,
                userId,
                daysToRequest
              );
              twiml.message().media(imageUrl);
            }
          } catch (error) {
            devLog("Erro ao gerar gráfico:", error);
            twiml.message(
              `📉 Desculpe, não foi possível gerar o gráfico.\n\nMotivo: ${error}`
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
              const imageUrl = await generateCategoryChart( 
                categoryReport,
                userId
              );
              twiml.message().media(imageUrl);
            }
          } catch (error) {
            devLog("Erro ao gerar gráfico por categorias:", error);
            twiml.message(
              "❌ Ocorreu um erro ao gerar o relatório por categorias. Tente novamente."
            );
          }
        }
        break;
      
        case "get_total": {
        let { category, month, monthName } = interpretation.data;

        if (!month || !monthName) {
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
          month = `${currentYear}-${currentMonth}`;
          const monthNameRaw = now.toLocaleString("pt-BR", { month: "long" });
          monthName =
            monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1);
        }

        const total = await calculateTotalExpenses(userId, category, month);

        let responseMessage;
        if (category) {
          responseMessage = `📉 *Gasto total* em _*${
            category.charAt(0).toUpperCase() + category.slice(1)
          }*_ no mês de _*${monthName}*_: \nR$ ${total.toFixed(2)}`;
        } else {
          responseMessage = `📉 *Gasto total* no mês de _*${monthName}*_: \nR$ ${total.toFixed(
            2
          )}`;
        }

        if (total > 0) {
          responseMessage += `.\n\nDigite "detalhes" para ver a lista de itens.`;

          conversationState[userId] = {
            type: "expense",
            category,
            month,
            monthName,
          };
        }

        twiml.message(responseMessage);

        break;
      }

      case "get_total_income": {
        let { category, month, monthName } = interpretation.data;

        if (!month || !monthName) {
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
          month = `${currentYear}-${currentMonth}`;
          const monthNameRaw = now.toLocaleString("pt-BR", { month: "long" });
          monthName =
            monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1);
        }

        const totalIncome = await calculateTotalIncome(userId, month, category);

        let responseMessage;
        if (category) {
          responseMessage = `📈 *Receita total* de _*${
            category.charAt(0).toUpperCase() + category.slice(1)
          }*_ no mês de _*${monthName}*_: \nR$ ${totalIncome.toFixed(2)}`;
        } else {
          responseMessage = `📈 *Receita total* no mês de _*${monthName}*_: \nR$ ${totalIncome.toFixed(
            2
          )}`;
        }

        if (totalIncome > 0) {
          responseMessage += `.\n\nDigite "detalhes" para ver a lista de itens.`;

          conversationState[userId] = {
            type: "income",
            category,
            month,
            monthName,
          };
        }

        twiml.message(responseMessage);
        break;
      }

      case "detalhes": {
        const previousData = conversationState[userId];

        if (!previousData || !previousData.type || !previousData.month) {
          twiml.message(
            "🚫 Não há um relatório recente para detalhar. Por favor, peça um total de gastos ou receitas primeiro."
          );
          break;
        }

        const { type, category, month, monthName } = previousData;

        devLog("Iniciando 'detalhes' com o contexto salvo:", previousData);

        let detalhesMessage;

        if (type === "income") {
          devLog("Chamando getIncomeDetails...");
          detalhesMessage = await getIncomeDetails(
            userId,
            month,
            monthName,
            category
          );
        } else {
          devLog("Chamando getExpenseDetails...");
          detalhesMessage = await getExpenseDetails(
            userId,
            month,
            monthName,
            category
          );
        }

        twiml.message(detalhesMessage);

        delete conversationState[userId];

        break;
      }

      case "greeting": {
        sendGreetingMessage(twiml);
        break;
      }

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
        if (!(await hasAccessToFeature(userMongoIdString, "adap-turbo"))) {
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
