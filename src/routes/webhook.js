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
import InstallmentPurchase from "../models/InstallmentPurchase.js";

const router = express.Router();

let conversationState = {};

router.post("/", async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const userMessage = req.body.Body;
  const userId = req.body.From;
  devLog(`Mensagem de ${userId}: "${userMessage}"`);

  const previousData = conversationState[userId];
  const userStats = await UserStats.findOne({ userId }, { blocked: 1 });

  if (userStats?.blocked) {
    twiml.message("🚫 Você está bloqueado de usar a ADAP.");
    res.writeHead(200, { "Content-Type": "text/xml" });
    return res.end(twiml.toString());
  }

  const generateId = customAlphabet("1234567890abcdef", 5);

  try {
    if (previousData?.awaiting === "installment_due_day") {
      const dueDay = parseInt(userMessage.trim(), 10);

      if (isNaN(dueDay) || dueDay < 1 || dueDay > 31) {
        twiml.message("Por favor, digite um dia válido (um número de 1 a 31).");
      } else {
        const {
          totalAmount,
          installmentAmount,
          description,
          installments,
          finalCategory,
        } = previousData.payload;
        const purchaseId = generateId();
        const today = new Date();
        const purchaseDay = today.getDate();
        const isPaymentInCurrentMonth = purchaseDay < dueDay;
        const initialInstallmentCount = isPaymentInCurrentMonth ? 1 : 0;

        const newInstallmentPurchase = new InstallmentPurchase({
          userId,
          originalMessageId: purchaseId,
          description,
          totalAmount,
          installmentAmount,
          numberOfInstallments: installments,
          currentInstallment: initialInstallmentCount,
          category: finalCategory,
          dueDay: dueDay,
          startDate: today,
        });
        await newInstallmentPurchase.save();

        let confirmationMessage;

        if (isPaymentInCurrentMonth) {
          devLog(
            "Pagamento no mês corrente. Registrando 1ª parcela como despesa."
          );
          const firstExpense = new Expense({
            userId,
            amount: installmentAmount,
            description: `${description} (1/${installments})`,
            category: finalCategory,
            date: today,
            messageId: generateId(),
            installmentParentId: purchaseId,
          });
          await firstExpense.save();

          await UserStats.findOneAndUpdate(
            { userId },
            { $inc: { totalSpent: installmentAmount } },
            { upsert: true }
          );

          confirmationMessage =
            `✅ Compra parcelada registrada!\n\n` +
            `*Item:* ${description}\n` +
            `*Categoria:* ${finalCategory}\n` +
            `*Parcelas:* ${installments}x de R$ ${installmentAmount.toFixed(
              2
            )} (Total: R$ ${totalAmount.toFixed(2)})\n` +
            `*Vencimento:* Todo dia ${dueDay}\n\n` +
            `Como sua fatura ainda não fechou, a 1ª parcela já foi adicionada aos seus gastos deste mês.\n\n` +
            `_Para cancelar, use o ID: *#${purchaseId}*_`;
        } else {
          devLog("Pagamento no próximo mês. Nenhuma despesa registrada agora.");

          confirmationMessage =
            `✅ Compra parcelada agendada!\n\n` +
            `*Item:* ${description}\n` +
            `*Categoria:* ${finalCategory}\n` +
            `*Parcelas:* ${installments}x de R$ ${installmentAmount.toFixed(
              2
            )} (Total: R$ ${totalAmount.toFixed(2)})\n` + 
            `*Vencimento:* Todo dia ${dueDay}\n\n` +
            `Como sua fatura deste mês já fechou, a 1ª parcela será lançada como despesa apenas no próximo vencimento. 😉\n\n` +
            `_Para cancelar, use o ID: *#${purchaseId}*_`;
        }

        twiml.message(confirmationMessage);
        delete conversationState[userId];
      }
    } else {
      const interpretation = await interpretMessageWithAI(userMessage);
      const userHasFreeCategorization = await hasAcessToFeature(
        userId,
        "add_expense_new_category"
      );
      devLog("intent:" + interpretation.intent);

      if (interpretation.intent !== "add_installment_expense") {
        conversationState[userId] = {
          ...(conversationState[userId] || {}),
          ...interpretation.data,
        };
      }

      switch (interpretation.intent) {
        case "add_income": {
          const { amount, description, category } = interpretation.data;
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
            await newIncome.save();
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
              const newIncome = new Income({
                userId,
                amount,
                description,
                category: similarIncome.category,
                date: new Date(),
                messageId: generateId(),
              });
              await newIncome.save();
              sendIncomeAddedMessage(twiml, newIncome);
            } else {
              const newIncome = new Income({
                userId,
                amount,
                description,
                category: finalCategory,
                date: new Date(),
                messageId: generateId(),
              });
              await newIncome.save();
              sendIncomeAddedMessage(twiml, newIncome);
            }
            await UserStats.findOneAndUpdate(
              { userId },
              { $inc: { totalIncome: amount } },
              { upsert: true }
            );
          }
          break;
        }

        case "add_expense_new_category": {
          const { type } = interpretation.data;

          if (type === "income") {
            devLog("Processando como nova receita...");
            if (
              !(await hasAcessToFeature(userId, "add_expense_new_category"))
            ) {
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
              await UserStats.findOneAndUpdate(
                { userId },
                { $addToSet: { createdCategories: category } },
                { new: true, upsert: true }
              );
            }
            const newIncome = new Income({
              userId,
              amount,
              description,
              category,
              date: new Date(),
              messageId: generateId(),
            });
            await newIncome.save();
            sendIncomeAddedMessage(twiml, newIncome);
            await UserStats.findOneAndUpdate(
              { userId },
              { $inc: { totalIncome: amount } },
              { upsert: true }
            );
            break;
          }

          devLog(
            "Intent 'add_expense_new_category' (despesa) detectado. Caindo para a lógica unificada..."
          );
        }

        case "add_expense": {
          let {
            amount,
            description,
            category: categoryFromAI,
          } = interpretation.data;
          let finalCategory = categoryFromAI;

          if (!categoryFromAI) {
            devLog(
              `Categoria não fornecida pela IA. Tentando inferir pelo histórico...`
            );
            const similarExpense = await Expense.findOne({
              userId,
              description: new RegExp(`^${description}$`, "i"),
            }).sort({ date: -1 });

            if (similarExpense) {
              finalCategory = similarExpense.category;
              devLog(`Categoria inferida do histórico: "${finalCategory}"`);
            }
          } else {
            devLog(
              `Usuário especificou a categoria: "${categoryFromAI}". Esta tem prioridade.`
            );
          }

          const userHasCustomCategoryAccess = await hasAcessToFeature(
            userId,
            "add_expense_new_category"
          );
          const userStats = await UserStats.findOne({ userId });
          const userCustomCategories = userStats?.createdCategories || [];

          finalCategory = finalCategory || "outro";
          let isValidCategory =
            VALID_CATEGORIES.includes(finalCategory) ||
            userCustomCategories.includes(finalCategory);

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
                `A categoria "${finalCategory}" não existe. Seu gasto com "${description}" foi adicionado na categoria "Outro".`
              );
              finalCategory = "outro";
            }
          }

          const newExpense = new Expense({
            userId,
            amount,
            description,
            category: finalCategory,
            date: new Date(),
            messageId: generateId(),
          });

          await newExpense.save();
          devLog("Salvando nova despesa:", newExpense);

          if (
            !twiml.response.children.some((child) => child.name === "Message")
          ) {
            sendExpenseAddedMessage(twiml, newExpense);
          }

          await UserStats.findOneAndUpdate(
            { userId },
            { $inc: { totalSpent: amount } },
            { upsert: true }
          );

          break;
        }

        case "add_installment_expense": {
          const {
            installmentAmount,
            description,
            installments,
            category: categoryFromAI,
          } = interpretation.data;

          if (!installmentAmount || !description || !installments) {
            twiml.message(
              "Para compras parceladas, informe o valor da parcela, a descrição e o número de vezes (ex: 100 celular em 10x)."
            );
            break;
          }

          const totalAmount = installmentAmount * installments;
          devLog(
            `Cálculo do valor total: ${installments}x de R$${installmentAmount.toFixed(
              2
            )} = R$${totalAmount.toFixed(2)}`
          );

          let finalCategory = categoryFromAI;
          if (!finalCategory) {
            devLog(
              `Categoria não fornecida para parcelamento. Tentando inferir pelo histórico de "${description}"...`
            );
            const similarExpense = await Expense.findOne({
              userId,
              description: new RegExp(`^${description}(\\s|$)`, "i"),
            }).sort({ date: -1 });

            if (similarExpense) {
              finalCategory = similarExpense.category;
              devLog(`Categoria inferida do histórico: "${finalCategory}"`);
            }
          }
          finalCategory = finalCategory || "outro";

          conversationState[userId] = {
            awaiting: "installment_due_day",
            payload: {
              totalAmount,
              installmentAmount,
              description,
              installments,
              finalCategory,
            },
          };
          devLog(
            "Estado de conversação salvo, aguardando dia do vencimento:",
            conversationState[userId]
          );

          twiml.message(
            "👍 Entendido! E em qual dia a fatura com esta parcela costuma vencer? (Digite apenas o número do dia, ex: 15)"
          );
          break;
        }

        case "cancel_installment_purchase": {
          const { purchaseId } = interpretation.data;
          if (!purchaseId) {
            twiml.message(
              "Por favor, informe o ID da compra que deseja cancelar (ex: Cancelar compra #123ab)."
            );
            break;
          }

          try {
            const purchase = await InstallmentPurchase.findOne({
              userId,
              originalMessageId: purchaseId,
            });

            if (!purchase) {
              twiml.message(
                `🚫 Nenhuma compra parcelada encontrada com o ID *#${purchaseId}*.`
              );
              break;
            }

            if (purchase.status === "cancelled") {
              twiml.message(
                `👍 A compra de "${purchase.description}" já está cancelled.`
              );
              break;
            }

            if (purchase.status === "completed") {
              twiml.message(
                `✅ A compra de "${purchase.description}" já foi totalmente paga e não pode ser cancelled.`
              );
              break;
            }

            purchase.status = "cancelled";
            await purchase.save();

            twiml.message(
              `✅ Cancelamento efetuado com sucesso!\n\n` +
                `A compra de *${purchase.description}* foi cancelada. Nenhuma nova parcela será gerada.\n\n` +
                `As ${purchase.currentInstallment} parcelas já pagas permanecerão no seu histórico.`
            );
          } catch (error) {
            devLog("Erro ao cancelar compra parcelada:", error);
            twiml.message(
              "❌ Ocorreu um erro ao tentar cancelar a compra. Tente novamente."
            );
          }
          break;
        }

        case "list_active_installments": {
          try {
            const activePurchases = await InstallmentPurchase.find({
              userId: userId,
              status: "active",
            }).sort({ startDate: 1 });

            if (activePurchases.length === 0) {
              twiml.message(
                "Você não possui nenhuma compra parcelada ativa no momento. 👍"
              );
              break;
            }

            let responseMessage = "📄 *Suas compras parceladas ativas:*\n\n";

            activePurchases.forEach((purchase) => {
              responseMessage +=
                `*Produto:* _${purchase.description}_\n` +
                `*Progresso:* _${purchase.currentInstallment} de ${purchase.numberOfInstallments}_\n` +
                `*Valor:* _R$ ${purchase.installmentAmount.toFixed(2)} / mês_\n` +
                `*Vencimento:* _todo dia ${purchase.dueDay}_\n` +
                `*ID:* _#${purchase.originalMessageId}_\n\n`;
            });

            twiml.message(responseMessage.trim());
          } catch (error) {
            devLog("Erro ao listar compras parceladas:", error);
            twiml.message(
              "❌ Ocorreu um erro ao buscar suas compras. Tente novamente."
            );
          }
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
          if (!month || !monthName) {
            const now = new Date();
            month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
              2,
              "0"
            )}`;
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
            month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
              2,
              "0"
            )}`;
            const monthNameRaw = now.toLocaleString("pt-BR", { month: "long" });
            monthName =
              monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1);
          }
          const totalIncome = await calculateTotalIncome(
            userId,
            month,
            category
          );
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
          const contextData = conversationState[userId];
          if (!contextData || !contextData.type || !contextData.month) {
            twiml.message(
              "🚫 Não há um relatório recente para detalhar. Peça um total de gastos ou receitas primeiro."
            );
            break;
          }
          const { type, category, month, monthName } = contextData;
          devLog("Iniciando 'detalhes' com o contexto salvo:", contextData);
          let detalhesMessage;
          if (type === "income") {
            detalhesMessage = await getIncomeDetails(
              userId,
              month,
              monthName,
              category
            );
          } else {
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

        case "reminder": {
          const { description, date } = interpretation.data;
          const newReminder = new Reminder({
            userId,
            description,
            date,
            messageId: generateId(),
          });
          await newReminder.save();
          await sendReminderMessage(twiml, userMessage, newReminder);
          break;
        }

        case "delete_reminder": {
          const { messageId } = interpretation.data;
          try {
            const reminder = await Reminder.findOneAndDelete({
              userId,
              messageId,
            });
            if (reminder) {
              sendReminderDeletedMessage(twiml, reminder);
            } else {
              twiml.message("🚫 Lembrete não encontrado.");
            }
          } catch (error) {
            devLog("Erro ao excluir lembrete:", error);
            twiml.message("🚫 Ocorreu um erro ao tentar excluir o lembrete.");
          }
          break;
        }

        case "get_total_reminders": {
          const totalReminders = await getTotalReminders(userId);
          sendTotalRemindersMessage(twiml, totalReminders);
          break;
        }

        case "financial_help": {
          if (!(await hasAcessToFeature(userId, "financial_help"))) {
            twiml.message(
              "🚫 Este recurso está disponível como um complemento pago. Com ele você pode pedir coneselhos financeiros ou de investimentos. Acesse o site para ativar: https://pay.hotmart.com/S98803486L?bid=1746998755631"
            );
            break;
          }
          await sendFinancialHelpMessage(twiml, userMessage);
          break;
        }

        default:
          sendHelpMessage(twiml);
          break;
      }
    }
  } catch (err) {
    devLog("Erro principal no webhook:", err);
    sendHelpMessage(twiml);
    // Garante que o estado seja limpo em caso de erro para não travar o usuário
    if (conversationState[userId]) {
      delete conversationState[userId];
    }
  }

  devLog("Resposta final do Twilio:", twiml.toString());
  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
});

export default router;
