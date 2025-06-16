import express from "express";
import twilio from "twilio";
import { devLog } from "../helpers/logger.js";
import { interpretMessageWithAI } from "../services/aiService.js";
import {
  calculateTotalExpenses,
  calculateTotalIncome,
  getExpensesReport,
  getCategoryReport,
  getTotalReminders,
  getExpenseDetails,
  getIncomeDetails,
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
  sendFinancialHelpMessage,
  sendReminderMessage,
  sendTotalRemindersMessage,
  sendReminderDeletedMessage,
} from "../helpers/messages.js";
import {
  VALID_CATEGORIES,
  VALID_CATEGORIES_INCOME,
} from "../utils/constants.js";
import { hasAcessToFeature } from "../helpers/userUtils.js";
import Reminder from "../models/Reminder.js";

const router = express.Router();

// Variável para armazenar o estado da conversa
let conversationState = {};

router.post("/", async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const userMessage = req.body.Body;
  const userId = req.body.From;
  devLog(userId);

  const previousData = conversationState[userId]; //variavel estado da conversa para detalhes
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
    devLog("intent:" + interpretation.intent);

    // Salvar o estado da conversa
    conversationState[userId] = { ...previousData, ...interpretation.data }; //spred e mantendo valores das variaveis originais

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

      case "add_expense_new_category": {
        const { type } = interpretation.data;

        if (type === "income") {
          devLog("Processando como nova receita...");
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
              "- doação\n\n" +
              "✅ E agora também é possível registrar receitas!\n\n" +
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
          }
          const { amount, description, category } = interpretation.data;
          if (!VALID_CATEGORIES_INCOME.includes(category)) {
            await UserStats.findOneAndUpdate({ userId }, { $addToSet: { createdCategories: category } }, { new: true, upsert: true });
          }
          const newIncome = new Income({ userId, amount, description, category, date: new Date(), messageId: generateId() });
          await newIncome.save();
          sendIncomeAddedMessage(twiml, newIncome);
          await UserStats.findOneAndUpdate({ userId }, { $inc: { totalIncome: amount } }, { upsert: true });
          break; 
        }
        
        devLog("Intent 'add_expense_new_category' (despesa) detectado. Caindo para a lógica unificada...");
      }

      case "add_expense": {
        let { amount, description, category: categoryFromAI } = interpretation.data;
        let finalCategory = categoryFromAI; 
        
        if (!categoryFromAI) {
          devLog(`Categoria não fornecida pela IA. Tentando inferir pelo histórico...`);
          const similarExpense = await Expense.findOne({
            userId,
            description: new RegExp(`^${description}$`, 'i') 
          }).sort({ date: -1 });

          if (similarExpense) {
            finalCategory = similarExpense.category;
            devLog(`Categoria inferida do histórico: "${finalCategory}"`);
          }
        } else {
            devLog(`Usuário especificou a categoria: "${categoryFromAI}". Esta tem prioridade.`);
        }

        const userHasCustomCategoryAccess = await hasAcessToFeature(userId, "add_expense_new_category");
        const userStats = await UserStats.findOne({ userId });
        const userCustomCategories = userStats?.createdCategories || [];

        finalCategory = finalCategory || 'outro'; 
        let isValidCategory = VALID_CATEGORIES.includes(finalCategory) || userCustomCategories.includes(finalCategory);

        if (!isValidCategory) {
            if (userHasCustomCategoryAccess) {
                isValidCategory = true;
                await UserStats.findOneAndUpdate(
                    { userId },
                    { $addToSet: { createdCategories: finalCategory } },
                    { upsert: true }
                );
            } else {
                twiml.message(
                  `A categoria "${finalCategory}" não existe e você não pode criar novas no plano gratuito.\n\n` +
                  `Seu gasto com "${description}" foi adicionado na categoria "Outro".`
                );
                finalCategory = "outro";
            }
        }
        
        const newExpense = new Expense({
            userId, amount, description, category: finalCategory, date: new Date(), messageId: generateId(),
        });

        await newExpense.save();
        devLog("Salvando nova despesa:", newExpense);
        
        if (isValidCategory) {
            sendExpenseAddedMessage(twiml, newExpense);
        }

        await UserStats.findOneAndUpdate({ userId }, { $inc: { totalSpent: amount } }, { upsert: true });

        break;
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

      case "get_total": {
        let { category, month, monthName } = interpretation.data;

        // Lógica de fallback para o mês atual (mantida)
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

        // Adicionada verificação de 'type' para maior robustez
        if (!previousData || !previousData.type || !previousData.month) {
          twiml.message(
            "🚫 Não há um relatório recente para detalhar. Por favor, peça um total de gastos ou receitas primeiro."
          );
          break;
        }

        // ALTERADO: Agora extraímos o 'type' do contexto!
        const { type, category, month, monthName } = previousData;

        devLog("Iniciando 'detalhes' com o contexto salvo:", previousData);

        let detalhesMessage; // Variável para armazenar a mensagem final

        // ALTERADO: Lógica condicional baseada no 'type'
        if (type === "income") {
          // Se o tipo for 'income', chama a função de detalhes de RECEITA
          devLog("Chamando getIncomeDetails...");
          detalhesMessage = await getIncomeDetails(
            userId,
            month,
            monthName,
            category
          );
        } else {
          // Caso contrário (será 'expense'), chama a função de detalhes de DESPESA
          devLog("Chamando getExpenseDetails...");
          detalhesMessage = await getExpenseDetails(
            userId,
            month,
            monthName,
            category
          );
        }

        twiml.message(detalhesMessage);

        // Limpa o estado após o uso bem-sucedido
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
