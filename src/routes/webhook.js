import express from "express";
import twilio from "twilio";
import {
  sendTextMessage,
  sendTextMessageTEST,
} from "../services/twilioService.js";
import { devLog } from "../helpers/logger.js";
import User from "../models/User.js";
import { fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "../utils/dateUtils.js";

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
  getActiveInstallments,
} from "../helpers/totalUtils.js";
import {
  generateChart,
  generateCategoryChart,
} from "../services/chartService.js";
import Transaction from "../models/Transaction.js";
import PaymentMethod from "../models/PaymentMethod.js";
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
  let responseHasBeenSent = false;

  console.log(userPhoneNumber);

  const { authorized, user } = await validateUserAccess(userPhoneNumber);

  if (!authorized) {
    twiml.message(
      `Poxa 🥲, infelizmente o seu teste ou assinatura acabou.🔒

Para continuar utilizando a sua assistente financeira e continuar deixando o seu financeiro organizado na palma da sua mão 💸, acesse o link abaixo e garanta já o seu plano: adapfinanceira.com.br/planos`
    );
    res.writeHead(200, { "Content-Type": "text/xml" });
    return res.end(twiml.toString());
    
  } else {
    const userObjectId = user._id;
    const userIdString = user._id.toString();
    devLog(`User DB ID: ${userIdString}`);

    const previousData = conversationState[userIdString] || {};
    const userStats = await UserStats.findOne(
      { userId: userObjectId },
      { blocked: 1 }
    );

    if (userStats?.blocked) {
      twiml.message("🚫 Você está bloqueado de usar a ADAP.");
    } else {
      const generateId = customAlphabet("1234567890abcdef", 8);
      const generateGroupId = customAlphabet(
        "1234567890abcdefghijklmnopqrstuvwxyz",
        22
      );

      if (previousData.awaiting === "installment_due_day") {
        const dueDay = parseInt(userMessage.trim(), 10);

        if (isNaN(dueDay) || dueDay < 1 || dueDay > 31) {
          twiml.message(
            "Por favor, digite um dia válido (um número de 1 a 31)."
          );
        } else {
          try {
            const { totalAmount, description, installments, categoryName } =
              previousData.payload;
            const installmentAmount = totalAmount / installments;

            let categoryDoc = await Category.findOne({
              userId: userObjectId,
              name: categoryName,
            });
            if (!categoryDoc) {
              categoryDoc = await new Category({
                userId: userObjectId,
                name: categoryName,
                color: "#CCCCCC",
              }).save();
            }

            const creditPaymentMethod = await PaymentMethod.findOne({
              type: "credit",
            });
            if (!creditPaymentMethod) {
              throw new Error(
                "Config Error: Payment method 'credit' not found."
              );
            }

            const messageIds = Array.from({ length: installments }, () =>
              generateId()
            );

            const newInstallmentsGroupId = messageIds[0];

            const transactionsToCreate = [];
            const purchaseDate = new Date();
            let startingMonthOffset = 0;
            if (purchaseDate.getDate() >= dueDay) {
              startingMonthOffset = 1;
            }

            for (let i = 0; i < installments; i++) {
              const paymentDate = new Date(purchaseDate);
              paymentDate.setHours(0, 0, 0, 0);

              paymentDate.setMonth(
                purchaseDate.getMonth() + i + startingMonthOffset
              );
              paymentDate.setDate(dueDay);

              transactionsToCreate.push({
                userId: userIdString,
                amount: installmentAmount,
                description: `${description} - ${i + 1}/${installments}`,
                date: paymentDate,
                messageId: messageIds[i],
                type: "expense",
                status: "pending",
                installmentsCount: installments,
                installmentsCurrent: i + 1,
                installmentsGroupId: newInstallmentsGroupId,
                categoryId: categoryDoc._id.toString(),
                paymentMethodId: creditPaymentMethod._id.toString(),
              });
            }

            await Transaction.insertMany(transactionsToCreate);

            twiml.message(
              `✅ Compra parcelada registrada!\n\n` +
                `*Item:* ${description}\n` +
                `*Valor:* ${installments}x de R$ ${installmentAmount.toFixed(
                  2
                )}\n\n` +
                `As ${installments} parcelas foram agendadas para todo dia ${dueDay}.\n` +
                `Para cancelar, use o ID: *#${newInstallmentsGroupId}*`
            );

            delete conversationState[userIdString];
          } catch (error) {
            devLog("Erro ao criar transações parceladas:", error);
            twiml.message(
              "❌ Ocorreu um erro ao registrar sua compra. Tente novamente mais tarde."
            );
            delete conversationState[userIdString];
          }
        }
      } else {
        try {
          const interpretation = await interpretMessageWithAI(
            userMessage,
            new Date().toISOString()
          );
          const userHasFreeCategorization = await hasAccessToFeature(
            userObjectId,
            "categories"
          );
          devLog("intent:" + interpretation.intent);

          conversationState[userIdString] = {
            ...previousData,
            ...interpretation.data,
          };

          switch (interpretation.intent) {
            case "add_installment_expense": {
              const { totalAmount, description, installments, category } =
                interpretation.data;

              if (!totalAmount || !description || !installments) {
                twiml.message(
                  "Para registrar um parcelamento, preciso do valor total, da descrição e do número de parcelas (ex: 3500 ps5 em 10x)."
                );
                break;
              }

              const hasCustomCategoryAccess = await hasAccessToFeature(
                userObjectId,
                "categories"
              );

              let finalCategoryName = category || "Outro";
              if (
                category &&
                !VALID_CATEGORIES.includes(category) &&
                !hasCustomCategoryAccess
              ) {
                twiml.message(
                  `A categoria "${category}" não existe e você não pode criar novas. Registre sem categoria para usar "Outro", ou use uma categoria padrão.`
                );
                break;
              }

              conversationState[userIdString] = {
                awaiting: "installment_due_day",
                payload: {
                  totalAmount,
                  description,
                  installments,
                  categoryName: finalCategoryName,
                },
              };
              devLog(
                "Estado de conversação salvo, aguardando dia do vencimento:",
                conversationState[userIdString]
              );

              twiml.message(
                "👍 Entendido! E em qual dia a fatura com esta parcela costuma vencer? (Digite apenas o número do dia, ex: 15)"
              );
              break;
            }

            case "add_income": {
              const { amount, description, category } = interpretation.data;
              devLog(amount, description, category);

              if (amount === null || isNaN(amount) || amount <= 0) {
                twiml.message(
                  "🚫 Não consegui identificar um valor válido para a receita. Por favor, tente novamente com um número positivo. Ex: 'Recebi 1000 salário'."
                );
                break;
              }

              let finalCategoryName = category || "outro";
              if (
                !VALID_CATEGORIES_INCOME.includes(finalCategoryName) &&
                !userHasFreeCategorization
              ) {
                finalCategoryName = "outro";
              }

              const categoryDoc = await getOrCreateCategory(
                userIdString,
                finalCategoryName
              );

              const defaultPaymentMethod = await PaymentMethod.findOne({
                type: "pix",
              });
              if (!defaultPaymentMethod) {
                throw new Error(
                  "Config Error: Payment method 'pix' not found."
                );
              }
              const newIncome = new Transaction({
                userId: userIdString,
                amount,
                description,
                categoryId: categoryDoc._id.toString(),
                type: "income",
                date: new Date(),
                messageId: generateId(),
                paymentMethodId: defaultPaymentMethod._id.toString(),
                status: "completed",
              });

              await newIncome.save();
              sendIncomeAddedMessage(twiml, {
                ...newIncome.toObject(),
                category: categoryDoc.name,
              });
              await UserStats.findOneAndUpdate(
                { userId: userObjectId },
                { $inc: { totalIncome: amount } },
                { upsert: true }
              );

              break;
            }

            case "add_expense": {
              const { amount, description, category } = interpretation.data;
              devLog(amount, description, category);

              if (amount === null || isNaN(amount) || amount <= 0) {
                twiml.message(
                  "🚫 Não consegui identificar um valor válido para a despesa. Por favor, tente novamente com um número positivo. Ex: '15 uber'."
                );
                break;
              }

              let finalCategoryName = category || "outro";
              if (
                !VALID_CATEGORIES.includes(finalCategoryName) &&
                !userHasFreeCategorization
              ) {
                finalCategoryName = "outro";
              }

              const categoryDoc = await getOrCreateCategory(
                userIdString,
                finalCategoryName
              );

              const defaultPaymentMethod = await PaymentMethod.findOne({
                type: "pix",
              });
              if (!defaultPaymentMethod) {
                throw new Error(
                  "Config Error: Payment method 'pix' not found."
                );
              }

              const newExpense = new Transaction({
                userId: userIdString,
                amount,
                description,
                categoryId: categoryDoc._id.toString(),
                type: "expense",
                date: new Date(),
                messageId: generateId(),
                paymentMethodId: defaultPaymentMethod._id.toString(),
                status: "completed",
              });

              await newExpense.save();
              devLog("Salvando nova despesa:", newExpense);
              sendExpenseAddedMessage(twiml, {
                ...newExpense.toObject(),
                category: categoryDoc.name,
              });
              await UserStats.findOneAndUpdate(
                { userId: userObjectId },
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

              if (newAmount === null || isNaN(newAmount) || newAmount <= 0) {
                twiml.message(
                  "🚫 Não consegui identificar um valor válido. Por favor, tente novamente com um número positivo."
                );
                break;
              }

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
                userIdString,
                newCategory
              );

              const defaultPaymentMethod = await PaymentMethod.findOne({
                type: "pix",
              });
              if (!defaultPaymentMethod) {
                throw new Error(
                  "Config Error: Payment method 'pix' not found."
                );
              }

              const newTransaction = new Transaction({
                userId: userIdString,
                amount: newAmount,
                description: newDescription,
                categoryId: categoryDoc._id.toString(),
                type: newType,
                date: new Date(),
                messageId: generateId(),
                paymentMethodId: defaultPaymentMethod._id.toString(),
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
                  { userId: userObjectId },
                  { $inc: { totalIncome: newAmount } },
                  { upsert: true }
                );
              } else {
                sendExpenseAddedMessage(twiml, {
                  ...newTransaction.toObject(),
                  category: categoryDoc.name,
                });
                await UserStats.findOneAndUpdate(
                  { userId: userObjectId },
                  { $inc: { totalSpent: newAmount } },
                  { upsert: true }
                );
              }

              break;
            }

            case "get_active_installments": {
              const installments = await getActiveInstallments(userIdString);

              if (installments.length === 0) {
                twiml.message(
                  "Você não possui compras parceladas ativas no momento. ✨"
                );
                break;
              }

              let responseMessage = "🛍️ *Suas compras parceladas ativas:*\n\n";

              installments.forEach((item) => {
                responseMessage +=
                  `*Item:* ${item.description}\n` +
                  `*Valor:* ${
                    item.totalInstallments
                  }x de R$ ${item.installmentAmount.toFixed(2)}\n` +
                  `*Restam:* ${item.pendingCount} parcelas\n` +
                  `*ID para excluir:* \`#${item.groupId}\`\n\n`;
              });

              responseMessage += `Para cancelar uma compra, envie "excluir parcelamento #ID".`;

              twiml.message(responseMessage);
              break;
            }

            case "delete_installment_group": {
              let { installmentsGroupId } = interpretation.data;
              if (!installmentsGroupId) {
                twiml.message(
                  "Por favor, informe o ID do parcelamento que deseja excluir (ex: excluir parcelamento #ID)."
                );
                break;
              }

              installmentsGroupId = installmentsGroupId.trim();

              try {
                const transactions = await Transaction.find({
                  userId: userIdString,
                  installmentsGroupId: installmentsGroupId,
                });

                if (transactions.length === 0) {
                  twiml.message(
                    `🚫 Nenhum parcelamento encontrado com o ID _${installmentsGroupId}_.`
                  );
                  break;
                }

                const description = transactions[0].description.split(" - ")[0];

                const deleteResult = await Transaction.deleteMany({
                  userId: userIdString,
                  installmentsGroupId: installmentsGroupId,
                });

                const totalAmountReverted = transactions.reduce(
                  (sum, t) => sum + t.amount,
                  0
                );
                await UserStats.findOneAndUpdate(
                  { userId: userObjectId },
                  { $inc: { totalSpent: -totalAmountReverted } }
                );

                twiml.message(
                  `🗑️ O parcelamento de *${description}* (${deleteResult.deletedCount} parcelas) foi excluído com sucesso.`
                );
                devLog(
                  `Excluídas ${deleteResult.deletedCount} transações para o grupo ${installmentsGroupId}.`
                );
              } catch (error) {
                devLog("Erro ao excluir grupo de parcelas:", error);
                twiml.message(
                  "❌ Ocorreu um erro ao tentar excluir o parcelamento. Tente novamente."
                );
              }
              break;
            }

            case "delete_transaction": {
              const { messageId } = interpretation.data;
              const transaction = await Transaction.findOne({
                userId: userObjectId,
                messageId,
              });
              if (!transaction) {
                twiml.message(
                  `🚫 Nenhuma transação encontrada com o ID #_${messageId}_ para exclusão.`
                );
                break;
              }

              if (transaction.installmentsGroupId) {
                twiml.message(
                  `🚫 A transação #_${messageId}_ faz parte de um parcelamento. Para removê-la, você precisa excluir o parcelamento inteiro.\n\n` +
                    `Use o comando: *excluir parcelamento* #${transaction.installmentsGroupId}`
                );
                break;
              }

              const category = await Category.findById(transaction.categoryId);
              await Transaction.findOneAndDelete({
                userId: userObjectId,
                messageId,
              });

              if (transaction.type === "income") {
                await UserStats.findOneAndUpdate(
                  { userId: userObjectId },
                  { $inc: { totalIncome: -transaction.amount } }
                );
                sendIncomeDeletedMessage(twiml, {
                  ...transaction.toObject(),
                  category: category.name,
                });
              } else {
                await UserStats.findOneAndUpdate(
                  { userId: userObjectId },
                  { $inc: { totalSpent: -transaction.amount } }
                );

                const isCustomCategory =
                  !VALID_CATEGORIES.includes(category.name) &&
                  !VALID_CATEGORIES_INCOME.includes(category.name);
                if (isCustomCategory) {
                  const count = await Transaction.countDocuments({
                    userId: userObjectId,
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
              const reportData = await getExpensesReport(
                userObjectId,
                daysToRequest
              );
              if (reportData.length === 0) {
                twiml.message(
                  `📉 Não há registros de gastos nos últimos ${daysToRequest} dias.`
                );
              } else {
                const imageUrl = await generateChart(
                  reportData,
                  userObjectId.toString(),
                  daysToRequest
                );
                twiml.message().media(imageUrl);
              }
              break;
            }

            case "generate_category_chart": {
              const { days = 30 } = interpretation.data;
              const categoryReport = await getCategoryReport(
                userObjectId,
                days
              );
              if (categoryReport.length === 0) {
                twiml.message(
                  `📊 Não há registros de gastos nos últimos ${days} dias para gerar um relatório por categoria.`
                );
              } else {
                const imageUrl = await generateCategoryChart(
                  categoryReport,
                  userObjectId.toString()
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
                const currentMonth = String(now.getMonth() + 1).padStart(
                  2,
                  "0"
                );
                month = `${currentYear}-${currentMonth}`;
                const monthNameRaw = now.toLocaleString("pt-BR", {
                  month: "long",
                });
                monthName =
                  monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1);
              }

              const total = await calculateTotalExpenses(
                userIdString,
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
                conversationState[userIdString] = {
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
                const currentMonth = String(now.getMonth() + 1).padStart(
                  2,
                  "0"
                );
                month = `${currentYear}-${currentMonth}`;
                const monthNameRaw = now.toLocaleString("pt-BR", {
                  month: "long",
                });
                monthName =
                  monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1);
              }

              const totalIncome = await calculateTotalIncome(
                userIdString,
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
                conversationState[userIdString] = {
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
              const previousData = conversationState[userIdString];
              const { type, category, month, monthName } = previousData;

              let messageChunks = [];
              if (type === "income") {
                messageChunks = await getIncomeDetails(
                  userIdString,
                  month,
                  monthName,
                  category
                );
              } else {
                messageChunks = await getExpenseDetails(
                  userIdString,
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
              sendSequentially();
              res.writeHead(200, { "Content-Type": "text/xml" });
              res.end(new twilio.twiml.MessagingResponse().toString());
              responseHasBeenSent = true;

              delete conversationState[userIdString];
              break;
            }

            case "reminder": {
              const { description, date } = interpretation.data;
              if (!date) {
                twiml.message(
                  "⏰ Por favor, forneça uma data e hora futuras válidas para o lembrete. Ex: 'Lembrar de ligar para o dentista amanhã às 14h'."
                );
                break;
              }

              const localDateString = date.slice(0, 19);
              const dateToSave = fromZonedTime(localDateString, TIMEZONE);

              if (!(dateToSave > new Date())) {
                twiml.message(
                  "⏰ Ops, essa data já passou! Por favor, forneça uma data e hora futuras."
                );
                break;
              }

              const newReminder = new Reminder({
                userId: userObjectId,
                userPhoneNumber: req.body.From.replace("whatsapp:", ""),
                description: description,
                date: dateToSave,
                messageId: generateId(),
              });

              await newReminder.save();
              await sendReminderMessage(twiml, userMessage, newReminder);
              break;
            }

            case "delete_reminder": {
              const { messageId } = interpretation.data;
              const reminder = await Reminder.findOneAndDelete({
                userId: userObjectId,
                messageId,
              });
              if (reminder) {
                sendReminderDeletedMessage(twiml, reminder);
              }
              break;
            }

            case "get_total_reminders": {
              const totalReminders = await getTotalReminders(userObjectId);
              sendTotalRemindersMessage(twiml, totalReminders);
              break;
            }

            case "financial_help": {
              if (!(await hasAccessToFeature(userObjectId, "adap-turbo"))) {
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
  }
});

export default router;
