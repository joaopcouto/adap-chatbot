import express from "express";
import twilio from "twilio";
import { sendTextMessage } from "../services/twilioService.js";
import { devLog } from "../helpers/logger.js";
import { generateCorrelationId } from "../helpers/logger.js";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { TIMEZONE, formatInBrazil } from "../utils/dateUtils.js";

import {
  interpretMessageWithAI,
  transcribeAudioWithWhisper,
  interpretDocumentWithAI,
} from "../services/aiService.js";
import {
  getMonthlySummary,
  calculateTotalExpenses,
  calculateTotalIncome,
  getExpensesReport,
  getCategoryReport,
  getIncomeByCategoryReport,
  getTotalReminders,
  getExpenseDetails,
  getIncomeDetails,
  getOrCreateCategory,
  getActiveInstallments,
  getFormattedInventory,
  getUserCategories,
  getFormattedCategories,
  deleteCategoryAndTransactions,
  checkCategoryLimit,
} from "../helpers/totalUtils.js";
import {
  generateChart,
  generateCategoryChart,
  generateIncomeChart,
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
import InventoryTemplate from "../models/InventoryTemplate.js";
import Product from "../models/Product.js";
import { hasAccessToFeature } from "../helpers/userUtils.js";
import Reminder from "../models/Reminder.js";
import { fixPhoneNumber } from "../utils/phoneUtils.js";
import { validateUserAccess } from "../services/userAccessService.js";
import reminderService from "../services/reminderService.js";
import googleIntegrationWhatsAppService from "../services/googleIntegrationWhatsAppService.js";
import UserActivity from "../models/UserActivity.js";

const router = express.Router();
let conversationState = {};

router.post("/", async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  let userMessage;
  let isImage = false;

  // imagem
  if (req.body.MediaUrl0 && req.body.MediaContentType0.includes("image")) {
    isImage = true;

    // audio
  } else if (
    req.body.MediaUrl0 &&
    req.body.MediaContentType0.includes("audio")
  ) {
    try {
      userMessage = await transcribeAudioWithWhisper(req.body.MediaUrl0);
    } catch (error) {
      devLog("Erro ao transcrever áudio:", error);
      twiml.message(
        "❌ Desculpe, não consegui processar seu áudio. Tente enviar uma mensagem de texto."
      );
      twiml.message(
        "❌ Desculpe, não consegui processar seu áudio. Tente enviar uma mensagem de texto."
      );
      res.writeHead(200, { "Content-Type": "text/xml" });
      return res.end(twiml.toString());
    }
    // texto
  } else {
    userMessage = req.body.Body;
  }

  const userPhoneNumber = fixPhoneNumber(req.body.From);
  let responseHasBeenSent = false;

  console.log(userPhoneNumber);

  if ((!userMessage || userMessage.trim() === "") && !isImage) {
    res.writeHead(200, { "Content-Type": "text/xml" });
    return res.end(twiml.toString());
  }

  devLog(`Mensagem de ${userPhoneNumber} para processar: "${userMessage}"`);

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

    await UserActivity.findOneAndUpdate(
      { userId: userObjectId },
      {
        $set: {
          name: user.name,
          email: user.email,
          phoneNumber: user.phoneNumber,
          lastInteractionAt: new Date(),
        },
        $inc: { messageCount: 1 },
      },
      { upsert: true }
    );

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

      if (previousData.awaiting === "delete_category_confirmation") {
        const { categoryName } = previousData.payload;

        if (userMessage.trim().toLowerCase() === "detalhes") {
          const result = await getExpenseDetails(
            userIdString,
            null,
            null,
            categoryName,
            null,
            null,
            null,
            false
          );

          const detailsMessage = result.messages.join("\n\n");

          const finalMessage = `${detailsMessage}\n\nApós revisar, você ainda deseja excluir a categoria *${categoryName}* e todos os lançamentos acima? Responda *sim* para confirmar.`;

          await sendTextMessage(req.body.From, finalMessage);
          responseHasBeenSent = true;
        } else if (userMessage.trim().toLowerCase() === "sim") {
          const result = await deleteCategoryAndTransactions(
            userIdString,
            categoryName
          );
          twiml.message(result.message);
          delete conversationState[userIdString];
        } else {
          twiml.message(
            `Ok, a exclusão da categoria *${categoryName}* foi cancelada.`
          );
          delete conversationState[userIdString];
        }
      } else if (previousData.awaiting === "document_category_confirmation") {
        const categoryName = userMessage.trim();
        const { documentType, ...data } = previousData.payload;

        const categoryDoc = await getOrCreateCategory(
          userIdString,
          categoryName
        );

        const transactionDetails = {
          amount: data.totalAmount,
          date: data.purchaseDate
            ? new Date(`${data.purchaseDate}T12:00:00Z`)
            : data.transactionDate
            ? new Date(`${data.transactionDate}T12:00:00Z`)
            : data.dueDate
            ? new Date(`${data.dueDate}T12:00:00Z`)
            : toZonedTime(new Date(), TIMEZONE),
          description:
            data.storeName ||
            data.provider ||
            (data.counterpartName
              ? `PIX para/de ${data.counterpartName}`
              : "Transação"),
          type: "expense",
        };

        if (documentType === "pix_receipt") {
          conversationState[userIdString] = {
            awaiting: "pix_type_confirmation",
            payload: {
              ...transactionDetails,
              categoryId: categoryDoc._id.toString(),
              categoryName: categoryName,
            }, // Passa o categoryName
          };
          twiml.message(
            "Este PIX foi um pagamento que você *FEZ* ou um valor que você *RECEBEU*?\n\nResponda `fiz` ou `recebi`."
          );
        } else {
          const defaultPaymentMethod = await PaymentMethod.findOne({
            type: "pix",
          });
          const newTransaction = new Transaction({
            userId: userIdString,
            ...transactionDetails,
            categoryId: categoryDoc._id.toString(),
            messageId: generateId(),
            paymentMethodId: defaultPaymentMethod._id.toString(),
            status: documentType === "utility_bill" ? "pending" : "completed",
          });
          await newTransaction.save();
          await UserStats.findOneAndUpdate(
            { userId: userObjectId },
            { $inc: { totalSpent: newTransaction.amount } },
            { upsert: true }
          );

          twiml.message(
            `✅ Transação de *${newTransaction.description}* registrada com sucesso na categoria *${categoryName}*!`
          );
          delete conversationState[userIdString];
        }
      } else if (previousData.awaiting === "template_fields") {
        const { templateName } = previousData.payload;
        const fields = userMessage
          .split(",")
          .map((f) => f.trim().charAt(0).toUpperCase() + f.trim().slice(1));

        if (fields.length < 2 || fields.length > 10) {
          twiml.message(
            "Por favor, forneça de 2 a 10 campos separados por vírgula."
          );
        } else {
          conversationState[userIdString] = {
            awaiting: "template_confirmation",
            payload: { templateName, fields },
          };
          twiml.message(
            `Ok! Os campos para o estoque *${templateName}* serão: *${fields.join(
              ", "
            )}*.\n\nEstá correto? Responda *sim* para salvar.`
          );
        }
      } else if (previousData.awaiting === "template_confirmation") {
        if (userMessage.trim().toLowerCase() === "sim") {
          const { templateName, fields } = previousData.payload;

          const newTemplate = new InventoryTemplate({
            userId: userIdString,
            templateName: templateName.toLowerCase(),
            fields: fields,
          });
          await newTemplate.save();

          twiml.message(
            `✅ Estoque para *${templateName}* criado com sucesso!\n\nPara adicionar seu primeiro item, diga: "adicionar ${templateName}"`
          );
          delete conversationState[userIdString];
        } else {
          twiml.message("Criação do estoque cancelada.");
          delete conversationState[userIdString];
        }
      } else if (previousData.awaiting === "product_attributes") {
        const { template } = previousData.payload;
        const values = userMessage.split(",").map((v) => v.trim());

        if (values.length !== template.fields.length) {
          twiml.message(
            `Ops! Você forneceu ${values.length} valores, mas preciso de ${
              template.fields.length
            }. Por favor, envie os valores na ordem correta: *${template.fields.join(
              ", "
            )}*`
          );
        } else {
          const attributes = {};
          template.fields.forEach((field, index) => {
            attributes[field] = values[index];
          });

          const productCount = await Product.countDocuments({
            userId: userIdString,
          });
          const customId = `P${(productCount + 1).toString().padStart(4, "0")}`;

          const newProduct = new Product({
            userId: userIdString,
            templateId: template._id,
            customId: customId,
            attributes: attributes,
            quantity: 0,
          });
          await newProduct.save();

          twiml.message(
            `✅ Produto *${Object.values(attributes).join(
              " "
            )}* (ID: #${customId}) adicionado ao estoque *${
              template.templateName
            }* com quantidade 0.\n\nPara dar entrada, diga: "entrada 10 #${customId}"`
          );
          delete conversationState[userIdString];
        }
      } else if (previousData.awaiting === "installment_due_day") {
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
      } else if (previousData.awaiting === "pix_type_confirmation") {
        const pixType = userMessage.trim().toLowerCase();
        if (pixType !== "fiz" && pixType !== "recebi") {
          twiml.message("Por favor, responda apenas com `fiz` ou `recebi`.");
        } else {
          const { amount, description, date, categoryId, categoryName } =
            previousData.payload;
          const type = pixType === "fiz" ? "expense" : "income";

          const defaultPaymentMethod = await PaymentMethod.findOne({
            type: "pix",
          });
          const newTransaction = new Transaction({
            userId: userIdString,
            amount,
            description,
            date,
            categoryId,
            type,
            status: "completed",
            messageId: generateId(),
            paymentMethodId: defaultPaymentMethod._id.toString(),
          });
          await newTransaction.save();

          const updateField = type === "expense" ? "totalSpent" : "totalIncome";
          await UserStats.findOneAndUpdate(
            { userId: userObjectId },
            { $inc: { [updateField]: amount } },
            { upsert: true }
          );

          twiml.message(
            `✅ PIX registrado com sucesso na categoria *${categoryName}*!`
          );
          delete conversationState[userIdString];
        }
      } else if (previousData.awaiting === "payment_status_confirmation") {
        const userInput = userMessage.trim().toLowerCase();
        if (userInput !== "sim" && userInput !== "não") {
          twiml.message("Por favor, responda apenas com `sim` ou `não`.");
        } else {
          const hasPaid = userInput === "sim";
          const { totalAmount, provider, dueDate, category } =
            previousData.payload;

          const status = hasPaid ? "completed" : "pending";
          const date = hasPaid
            ? toZonedTime(new Date(), TIMEZONE)
            : new Date(`${dueDate}T12:00:00Z`);
          const description = `Conta ${provider}`;

          const categoryDoc = await getOrCreateCategory(
            userIdString,
            category.toLowerCase()
          );
          const defaultPaymentMethod = await PaymentMethod.findOne({
            type: "pix",
          });

          const newExpense = new Transaction({
            userId: userIdString,
            amount: totalAmount,
            description,
            categoryId: categoryDoc._id.toString(),
            type: "expense",
            date,
            status,
            messageId: generateId(),
            paymentMethodId: defaultPaymentMethod._id.toString(),
          });
          await newExpense.save();
          await UserStats.findOneAndUpdate(
            { userId: userObjectId },
            { $inc: { totalSpent: totalAmount } }
          );

          if (!hasPaid) {
            const reminderDate = new Date(`${dueDate}T12:00:00Z`);
            const newReminder = new Reminder({
              userId: userObjectId,
              userPhoneNumber: req.body.From.replace("whatsapp:", ""),
              description: `Pagar conta da ${provider} no valor de R$ ${totalAmount.toFixed(
                2
              )}`,
              date: reminderDate,
              messageId: generateId(),
            });
            await newReminder.save();
            twiml.message(
              `✅ Conta da *${provider}* registrada como *pendente* e lembrete criado para o dia do vencimento!`
            );
          } else {
            twiml.message(
              `✅ Conta da *${provider}* registrada como *paga* com sucesso!`
            );
          }
          delete conversationState[userIdString];
        }
      } else if (previousData.awaiting === "early_reminder_prompt") {
        try {
          const interpretation = await interpretMessageWithAI(
            userMessage,
            new Date().toISOString()
          );

          if (interpretation.intent === "set_early_reminder") {
            const { value, unit } = interpretation.data;
            const { reminderId } = previousData.payload;

            const reminder = await Reminder.findById(reminderId);
            if (!reminder) {
              twiml.message(
                "Ops, não encontrei o lembrete original. Tente criar um novo."
              );
              delete conversationState[userIdString];
            } else {
              let earlyDate = new Date(reminder.date);
              if (unit.includes("minuto")) {
                earlyDate.setMinutes(earlyDate.getMinutes() - value);
              } else if (unit.includes("hora")) {
                earlyDate.setHours(earlyDate.getHours() - value);
              }

              if (earlyDate < new Date()) {
                twiml.message(
                  "Essa antecedência faria o lembrete ser no passado. Por favor, escolha um tempo menor."
                );
              } else {
                await Reminder.updateOne(
                  { _id: reminder._id },
                  { $set: { earlyReminderDate: earlyDate } }
                );
                twiml.message(
                  `✅ Confirmado! Irei te lembrar ${value} ${unit} antes.`
                );
                delete conversationState[userIdString];
              }
            }
          } else {
            twiml.message(
              "Ok, sem problemas! O lembrete principal está mantido. 😉"
            );
            delete conversationState[userIdString];
          }
        } catch (err) {
          devLog("Erro ao processar lembrete antecipado:", err);
          twiml.message(
            "Ok, sem problemas! O lembrete principal está mantido. 😉"
          );
          delete conversationState[userIdString];
        }
      } else {
        try {
          if (isImage) {
            twiml.message("🔍 Analisando seu documento... Só um instante.");
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(twiml.toString());
            responseHasBeenSent = true;

            const result = await interpretDocumentWithAI(req.body.MediaUrl0);

            if (result.documentType === "unknown" || !result.data) {
              await sendTextMessage(
                req.body.From,
                "🫤 Desculpe, não consegui identificar um documento financeiro válido nesta imagem. Tente uma foto mais nítida."
              );
              return;
            }

            const userCategories = await getUserCategories(userIdString);
            let categoryMessage = "";
            if (userCategories.length > 0) {
              categoryMessage +=
                "\n\n*Suas categorias:*\n- " + userCategories.join("\n- ");
            }

            conversationState[userIdString] = {
              awaiting: "document_category_confirmation",
              payload: { documentType: result.documentType, ...result.data },
            };

            let confirmationMessage = `🧾 Documento identificado!\n\n`;
            const data = result.data;
            if (result.documentType === "store_receipt") {
              confirmationMessage += `*Compra:* ${
                data.storeName
              }\n*Valor:* R$ ${data.totalAmount.toFixed(2)}`;
            } else if (result.documentType === "utility_bill") {
              confirmationMessage += `*Conta:* ${
                data.provider
              }\n*Valor:* R$ ${data.totalAmount.toFixed(2)}`;
            } else if (result.documentType === "pix_receipt") {
              confirmationMessage += `*PIX:* ${
                data.counterpartName
              }\n*Valor:* R$ ${data.totalAmount.toFixed(2)}`;
            }
            confirmationMessage += `\n\nEm qual categoria você gostaria de salvar?${categoryMessage}\n\n_Digite o nome de uma categoria ou crie uma nova._`;

            await sendTextMessage(req.body.From, confirmationMessage);
          } else {
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
                  date: toZonedTime(new Date(), TIMEZONE),
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
                  date: toZonedTime(new Date(), TIMEZONE),
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

                const alertMessage = await checkCategoryLimit(
                  userIdString,
                  categoryDoc._id.toString(),
                  amount
                );
                if (alertMessage) {
                  setTimeout(
                    () => sendTextMessage(req.body.From, alertMessage),
                    1000
                  );
                }
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
                  date: toZonedTime(new Date(), TIMEZONE),
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
                  const alertMessage = await checkCategoryLimit(
                    userIdString,
                    categoryDoc._id.toString(),
                    newAmount
                  );
                  if (alertMessage) {
                    setTimeout(
                      () => sendTextMessage(req.body.From, alertMessage),
                      1000
                    );
                  }
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

                let responseMessage =
                  "🛍️ *Suas compras parceladas ativas:*\n\n";

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

                  const description =
                    transactions[0].description.split(" - ")[0];

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

                const category = await Category.findById(
                  transaction.categoryId
                );
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
                  userIdString,
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
                  userIdString,
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
              case "generate_income_category_chart": {
                const { days = 30 } = interpretation.data;
                const incomeReport = await getIncomeByCategoryReport(
                  userIdString,
                  days
                );

                if (incomeReport.length === 0) {
                  twiml.message(
                    `📈 Você não tem receitas registradas nos últimos ${days} dias para gerar um relatório.`
                  );
                } else {
                  const imageUrl = await generateIncomeChart(
                    incomeReport,
                    userObjectId.toString()
                  );
                  twiml.message().media(imageUrl);
                }
                break;
              }
              case "get_total":
              case "get_total_income": {
                let { category, month, monthName, startDate, endDate } =
                  interpretation.data;
                let periodName;

                if (!startDate && !month) {
                  twiml.message(
                    "🤔 Não entendi o período. Você pode pedir o total para o mês atual (ex: 'gasto total') ou para um período específico (ex: 'gastos de 25/09 a 07/10')."
                  );
                  break;
                }

                if (startDate && endDate) {
                  const start = new Date(startDate);
                  const end = new Date(endDate);

                  if (start.toDateString() === end.toDateString()) {
                    periodName = `no dia ${formatInBrazil(start)}`;
                  } else {
                    periodName = `de ${formatInBrazil(
                      start
                    )} a ${formatInBrazil(end)}`;
                  }
                } else {
                  periodName = `no mês de ${monthName}`;
                }

                const isIncome = interpretation.intent === "get_total_income";

                const total = isIncome
                  ? await calculateTotalIncome(
                      userIdString,
                      month,
                      category,
                      startDate,
                      endDate
                    )
                  : await calculateTotalExpenses(
                      userIdString,
                      category,
                      month,
                      startDate,
                      endDate
                    );

                if (total === 0) {
                  let zeroMessage = `🤷‍♀️ Nenhuma movimentação registrada ${periodName}.`;
                  if (category) {
                    const catFormatted =
                      category.charAt(0).toUpperCase() + category.slice(1);
                    zeroMessage = `🤷‍♀️ Nenhum(a) ${
                      isIncome ? "receita" : "gasto"
                    } na categoria _*${catFormatted}*_ ${periodName}.`;
                  }
                  twiml.message(zeroMessage);
                } else {
                  const typeText = isIncome ? "Receita total" : "Gasto total";
                  const icon = isIncome ? "📈" : "📉";

                  let responseMessage = `${icon} *${typeText}* ${periodName}: \nR$ ${total.toFixed(
                    2
                  )}`;
                  if (category) {
                    const catFormatted =
                      category.charAt(0).toUpperCase() + category.slice(1);
                    responseMessage = `${icon} *${typeText}* em _*${catFormatted}*_ ${periodName}: \nR$ ${total.toFixed(
                      2
                    )}`;
                  }

                  responseMessage += `\n\nDigite "detalhes" para ver a lista de itens.`;

                  conversationState[userIdString] = {
                    type: isIncome ? "income" : "expense",
                    category,
                    month,
                    monthName,
                    startDate,
                    endDate,
                    periodName,
                  };
                  twiml.message(responseMessage);
                }
                break;
              }
              case "get_balance": {
                const now = new Date();
                const currentMonthCode = `${now.getFullYear()}-${String(
                  now.getMonth() + 1
                ).padStart(2, "0")}`;
                const currentMonthName =
                  now
                    .toLocaleString("pt-BR", { month: "long" })
                    .charAt(0)
                    .toUpperCase() +
                  now.toLocaleString("pt-BR", { month: "long" }).slice(1);

                const summary = await getMonthlySummary(
                  userIdString,
                  currentMonthCode
                );

                const balancePrefix = summary.balance >= 0 ? "💰" : "⚠️";
                const balanceMessage = `${balancePrefix} *Saldo de ${currentMonthName}:* *R$ ${summary.balance.toFixed(
                  2
                )}*`;

                twiml.message(balanceMessage);
                break;
              }
              case "detalhes": {
                const previousData = conversationState[userIdString];

                if (!previousData || !previousData.type) {
                  twiml.message(
                    "Para ver os detalhes, primeiro peça um resumo dos seus gastos ou receitas. Por exemplo, envie 'gasto total' ou 'minhas receitas'."
                  );
                  twiml.message(
                    "Para ver os detalhes, primeiro peça um resumo dos seus gastos ou receitas. Por exemplo, envie 'gasto total' ou 'minhas receitas'."
                  );
                  break;
                }

                const {
                  type,
                  category,
                  month,
                  monthName,
                  startDate,
                  endDate,
                  periodName,
                } = previousData;

                let result;
                if (type === "income") {
                  result = await getIncomeDetails(
                    userIdString,
                    month,
                    monthName,
                    category,
                    startDate,
                    endDate,
                    periodName
                  );
                } else {
                  result = await getExpenseDetails(
                    userIdString,
                    month,
                    monthName,
                    category,
                    startDate,
                    endDate,
                    periodName
                  );
                }

                const { messages, transactionIds } = result;

                if (transactionIds && transactionIds.length > 0) {
                  conversationState[userIdString] = {
                    ...previousData,
                    detailedList: transactionIds,
                  };
                } else {
                  delete conversationState[userIdString];
                }

                const sendSequentially = async () => {
                  try {
                    for (const chunk of messages) {
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

                break;
              }
              case "delete_list_item": {
                const { itemNumber } = interpretation.data;
                const state = conversationState[userIdString];

                if (
                  !state ||
                  !state.detailedList ||
                  state.detailedList.length === 0
                ) {
                  twiml.message(
                    "Não encontrei uma lista de itens para apagar. Por favor, gere os 'detalhes' de seus gastos ou receitas primeiro."
                  );
                  break;
                }

                const index = itemNumber - 1;

                if (index < 0 || index >= state.detailedList.length) {
                  twiml.message(
                    `Número de item inválido. Por favor, escolha um número entre 1 e ${state.detailedList.length}.`
                  );
                  break;
                }

                const transactionIdToDelete = state.detailedList[index];

                if (transactionIdToDelete === null) {
                  twiml.message(
                    `🤔 O item número ${itemNumber} já foi apagado nesta sessão.`
                  );
                  break;
                }

                const transaction = await Transaction.findById(
                  transactionIdToDelete
                );

                if (!transaction) {
                  conversationState[userIdString].detailedList[index] = null;
                  twiml.message(
                    "Ops, este item já foi apagado ou não foi encontrado no banco de dados."
                  );
                  twiml.message(
                    "Ops, este item já foi apagado ou não foi encontrado no banco de dados."
                  );
                  break;
                }

                await Transaction.findByIdAndDelete(transactionIdToDelete);

                const updateField =
                  transaction.type === "income" ? "totalIncome" : "totalSpent";
                await UserStats.findOneAndUpdate(
                  { userId: userObjectId },
                  { $inc: { [updateField]: -transaction.amount } }
                );

                twiml.message(
                  `✅ Item "${
                    transaction.description
                  }" no valor de R$ ${transaction.amount.toFixed(
                    2
                  )} foi apagado com sucesso!`
                );

                conversationState[userIdString].detailedList[index] = null;

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

                const reminderData = {
                  description: description,
                  date: dateToSave,
                };

                const userPhoneNumberClean = req.body.From.replace(
                  "whatsapp:",
                  ""
                );
                const correlationId = generateCorrelationId();

                try {
                  const result = await reminderService.createReminder(
                    reminderData,
                    userIdString,
                    userPhoneNumberClean,
                    correlationId
                  );

                  conversationState[userIdString] = {
                    awaiting: "early_reminder_prompt",
                    payload: { reminderId: result.reminder._id },
                  };

                  const originalMessage = await sendReminderMessage(
                    null,
                    userMessage,
                    result.reminder
                  );

                  const finalMessage = `${originalMessage}\n\n*Gostaria de ser lembrado minutos ou horas antes do seu compromisso?*`;

                  await sendTextMessage(req.body.From, finalMessage);
                  responseHasBeenSent = true;
                } catch (error) {
                  devLog(
                    `[Webhook] Error creating reminder for user ${userIdString} (${correlationId}):`,
                    error
                  );
                  twiml.message(
                    "❌ Ocorreu um erro ao criar o lembrete. Tente novamente mais tarde."
                  );
                }
                break;
              }
              case "delete_reminder": {
                const { messageId } = interpretation.data;

                try {
                  const result = await reminderService.deleteReminder(
                    messageId,
                    userIdString
                  );
                  if (result.found) {
                    sendReminderDeletedMessage(twiml, result.reminder);
                  } else {
                    twiml.message(
                      `🚫 Nenhum lembrete encontrado com o ID #_${messageId}_ para exclusão.`
                    );
                  }
                } catch (error) {
                  devLog(
                    `[Webhook] Error deleting reminder ${messageId} for user ${userIdString}:`,
                    error
                  );
                  twiml.message(
                    "❌ Ocorreu um erro ao excluir o lembrete. Tente novamente mais tarde."
                  );
                }
                break;
              }
              case "get_total_reminders": {
                const totalReminders = await getTotalReminders(userIdString);
                sendTotalRemindersMessage(twiml, totalReminders);
                break;
              }
              case "list_categories": {
                if (!(await hasAccessToFeature(userObjectId, "categories"))) {
                  twiml.message(
                    "🚫 A visualização de categorias personalizadas está disponível apenas como um complemento."
                  );
                  break;
                }
                const categoriesMessage = await getFormattedCategories(
                  userIdString
                );
                twiml.message(categoriesMessage);
                break;
              }
              case "delete_category": {
                if (!(await hasAccessToFeature(userObjectId, "categories"))) {
                  twiml.message(
                    "🚫 A exclusão de categorias personalizadas está disponível apenas como um complemento."
                  );
                  break;
                }
                const { category } = interpretation.data;
                if (!category) {
                  twiml.message(
                    "Por favor, especifique o nome da categoria que deseja excluir. Ex: *excluir categoria lazer*"
                  );
                  break;
                }

                const standardizedName = category.trim().toLowerCase();
                const categoryDoc = await Category.findOne({
                  userId: userIdString,
                  name: standardizedName,
                });

                if (!categoryDoc) {
                  twiml.message(`🚫 Categoria "*${category}*" não encontrada.`);
                  break;
                }

                const transactions = await Transaction.find({
                  userId: userIdString,
                  categoryId: categoryDoc._id.toString(),
                });
                const totalAmount = transactions.reduce(
                  (sum, t) => sum + t.amount,
                  0
                );

                conversationState[userIdString] = {
                  awaiting: "delete_category_confirmation",
                  payload: { categoryName: category },
                };

                let confirmationMsg = `Você está prestes a excluir a categoria "*${category}*".\n\n`;
                confirmationMsg += `Isso irá apagar permanentemente *${
                  transactions.length
                }* lançamento(s), totalizando *R$ ${totalAmount.toFixed(
                  2
                )}*.\n\n`;
                confirmationMsg += `Digite *detalhes* para revisar os lançamentos ou responda *sim* para confirmar a exclusão.\n\n_(Esta ação não pode ser desfeita)_`;

                twiml.message(confirmationMsg);
                break;
              }
              case "set_category_limit": {
                if (!(await hasAccessToFeature(userObjectId, "categories"))) {
                  twiml.message(
                    "🚫 A definição de limites está disponível apenas como um complemento."
                  );
                  break;
                }

                const { category, amount } = interpretation.data;

                if (!category || amount === undefined || amount <= 0) {
                  twiml.message(
                    "Formato incorreto. Use: *limite [categoria] para [valor]*. Ex: `limite alimentação para 500`"
                  );
                  break;
                }

                const standardizedName = category.trim().toLowerCase();
                const categoryDoc = await Category.findOne({
                  userId: userIdString,
                  name: standardizedName,
                });

                if (!categoryDoc) {
                  twiml.message(
                    `🚫 Categoria "*${category}*" não encontrada. Crie-a primeiro registrando um gasto nela.`
                  );
                  break;
                }

                await Category.updateOne(
                  { _id: categoryDoc._id },
                  { $set: { monthlyLimit: amount } }
                );

                twiml.message(
                  `✅ Limite para a categoria "*${category}*" definido para *R$ ${amount.toFixed(
                    2
                  )}* por mês.`
                );
                break;
              }
              case "google_connect": {
                try {
                  const correlationId = generateCorrelationId();
                  devLog(
                    `[Webhook] Google connect request for user ${userObjectId} (${correlationId})`
                  );

                  // Generate OAuth URL
                  const authResult =
                    await googleIntegrationWhatsAppService.generateAuthUrl(
                      userObjectId.toString(),
                      correlationId
                    );

                  if (authResult.success) {
                    const connectionMessage =
                      googleIntegrationWhatsAppService.formatConnectionMessage(
                        authResult.authUrl
                      );
                    twiml.message(connectionMessage);
                  } else {
                    twiml.message(
                      "❌ Erro ao gerar link de conexão. Tente novamente mais tarde."
                    );
                  }
                } catch (error) {
                  devLog(
                    `[Webhook] Error generating Google auth URL for user ${userObjectId}:`,
                    error
                  );
                  twiml.message(
                    "❌ Erro ao conectar com Google Calendar. Tente novamente mais tarde."
                  );
                }
                break;
              }
              case "google_disconnect": {
                try {
                  const correlationId = generateCorrelationId();
                  devLog(
                    `[Webhook] Google disconnect request for user ${userObjectId} (${correlationId})`
                  );

                  const result =
                    await googleIntegrationWhatsAppService.disconnectGoogle(
                      userObjectId.toString(),
                      correlationId
                    );

                  twiml.message(result.message);
                } catch (error) {
                  devLog(
                    `[Webhook] Error disconnecting Google for user ${userObjectId}:`,
                    error
                  );
                  twiml.message(
                    "❌ Erro ao desconectar Google Calendar. Tente novamente mais tarde."
                  );
                }
                break;
              }
              case "google_status": {
                try {
                  const correlationId = generateCorrelationId();
                  devLog(
                    `[Webhook] Google status request for user ${userObjectId} (${correlationId})`
                  );

                  const status =
                    await googleIntegrationWhatsAppService.getIntegrationStatus(
                      userObjectId.toString(),
                      correlationId
                    );

                  const statusMessage =
                    googleIntegrationWhatsAppService.formatStatusMessage(
                      status
                    );
                  twiml.message(statusMessage);
                } catch (error) {
                  devLog(
                    `[Webhook] Error getting Google status for user ${userObjectId}:`,
                    error
                  );
                  twiml.message(
                    "❌ Erro ao verificar status do Google Calendar. Tente novamente mais tarde."
                  );
                }
                break;
              }
              case "google_enable_sync": {
                try {
                  const correlationId = generateCorrelationId();
                  devLog(
                    `[Webhook] Google enable sync request for user ${userObjectId} (${correlationId})`
                  );

                  const result =
                    await googleIntegrationWhatsAppService.setCalendarSyncEnabled(
                      userObjectId.toString(),
                      true,
                      correlationId
                    );

                  twiml.message(result.message);
                } catch (error) {
                  devLog(
                    `[Webhook] Error enabling Google sync for user ${userObjectId}:`,
                    error
                  );

                  if (error.message.includes("must be connected")) {
                    twiml.message(
                      "❌ Você precisa conectar sua conta Google primeiro. Digite 'conectar google calendar' para começar."
                    );
                  } else {
                    twiml.message(
                      "❌ Erro ao ativar sincronização. Tente novamente mais tarde."
                    );
                  }
                }
                break;
              }
              case "google_disable_sync": {
                try {
                  const correlationId = generateCorrelationId();
                  devLog(
                    `[Webhook] Google disable sync request for user ${userObjectId} (${correlationId})`
                  );

                  const result =
                    await googleIntegrationWhatsAppService.setCalendarSyncEnabled(
                      userObjectId.toString(),
                      false,
                      correlationId
                    );

                  twiml.message(result.message);
                } catch (error) {
                  devLog(
                    `[Webhook] Error disabling Google sync for user ${userObjectId}:`,
                    error
                  );

                  if (error.message.includes("must be connected")) {
                    twiml.message(
                      "❌ Você precisa conectar sua conta Google primeiro. Digite 'conectar google calendar' para começar."
                    );
                  } else {
                    twiml.message(
                      "❌ Erro ao desativar sincronização. Tente novamente mais tarde."
                    );
                  }
                }
                break;
              }
              case "google_debug": {
                try {
                  const correlationId = generateCorrelationId();
                  devLog(
                    `[Webhook] Google debug request for user ${userObjectId} (${correlationId})`
                  );

                  const diagnostics =
                    await googleIntegrationWhatsAppService.getDiagnosticInfo(
                      correlationId
                    );
                  const diagnosticMessage =
                    googleIntegrationWhatsAppService.formatDiagnosticMessage(
                      diagnostics
                    );

                  twiml.message(diagnosticMessage);
                } catch (error) {
                  devLog(
                    `[Webhook] Error generating Google diagnostics for user ${userObjectId}:`,
                    error
                  );
                  twiml.message(
                    "❌ Erro ao gerar diagnóstico. Tente novamente mais tarde."
                  );
                }
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
              case "create_inventory_template": {
                if (!(await hasAccessToFeature(userObjectId, "inventory"))) {
                  twiml.message(
                    "🚫 A funcionalidade de controle de estoque está disponível apenas no plano Diamante."
                  );
                  break;
                }

                const { templateName } = interpretation.data;
                if (!templateName) {
                  twiml.message(
                    "Por favor, me diga o nome do estoque que você quer criar. Ex: 'criar estoque de camisetas'"
                  );
                  break;
                }

                const existing = await InventoryTemplate.findOne({
                  userId: userIdString,
                  templateName: templateName.toLowerCase(),
                });
                if (existing) {
                  twiml.message(
                    `Você já possui um estoque chamado *${templateName}*. Escolha outro nome.`
                  );
                  break;
                }

                conversationState[userIdString] = {
                  awaiting: "template_fields",
                  payload: { templateName },
                };
                twiml.message(
                  `Vamos criar o estoque *${templateName}*! 🎉\n\nQuais informações você quer salvar para cada item? Envie os nomes dos campos separados por vírgula (de 2 a 10).\n\n*Exemplo:* nome, cor, tamanho, preço de custo`
                );
                break;
              }
              case "add_product_to_inventory": {
                if (!(await hasAccessToFeature(userObjectId, "inventory"))) {
                  twiml.message(
                    "🚫 A funcionalidade de controle de estoque está disponível apenas no plano Diamante."
                  );
                  break;
                }

                const { templateName } = interpretation.data;
                if (!templateName) {
                  twiml.message(
                    "Por favor, especifique em qual estoque você quer adicionar o item. Ex: 'adicionar camiseta'"
                  );
                  break;
                }

                const template = await InventoryTemplate.findOne({
                  userId: userIdString,
                  templateName: {
                    $regex: new RegExp(`^${templateName.toLowerCase()}`, "i"),
                  },
                });

                if (!template) {
                  twiml.message(
                    `Não encontrei um estoque chamado *${templateName}*. Para ver seus estoques, diga "listar estoques".`
                  );
                  break;
                }

                conversationState[userIdString] = {
                  awaiting: "product_attributes",
                  payload: { template },
                };

                twiml.message(
                  `Ok, adicionando um novo item ao estoque *${
                    template.templateName
                  }*.\n\nPor favor, envie os valores para os seguintes campos, separados por vírgula:\n\n*${template.fields.join(
                    ", "
                  )}*`
                );
                break;
              }
              case "list_inventory_templates": {
                if (!(await hasAccessToFeature(userObjectId, "inventory"))) {
                  twiml.message(
                    "🚫 A funcionalidade de controle de estoque está disponível apenas no plano Diamante."
                  );
                  break;
                }

                const templates = await InventoryTemplate.find({
                  userId: userIdString,
                });

                if (templates.length === 0) {
                  twiml.message(
                    "Você ainda não criou nenhum tipo de estoque. Para começar, diga 'criar estoque de [nome]'"
                  );
                } else {
                  let message = "📦 *Seus Estoques Criados:*\n\n";
                  templates.forEach((t) => {
                    message += `• *${
                      t.templateName.charAt(0).toUpperCase() +
                      t.templateName.slice(1)
                    }*\n   - Campos: _${t.fields.join(", ")}_\n\n`;
                  });
                  message += `Para adicionar um item, diga "adicionar [nome do estoque]".`;
                  twiml.message(message);
                }
                break;
              }
              case "view_inventory": {
                if (!(await hasAccessToFeature(userObjectId, "inventory"))) {
                  twiml.message(
                    "🚫 A funcionalidade de controle de estoque está disponível apenas no plano Diamante."
                  );
                  break;
                }
                const { templateName } = interpretation.data;
                if (!templateName) {
                  twiml.message(
                    "Por favor, especifique qual estoque você quer ver. Ex: 'ver estoque de livros'"
                  );
                  break;
                }

                const { messages } = await getFormattedInventory(
                  userIdString,
                  templateName
                );

                const sendSequentially = async () => {
                  for (const chunk of messages) {
                    await sendTextMessage(req.body.From, chunk);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                  }
                };
                sendSequentially();
                responseHasBeenSent = true;
                break;
              }
              case "update_inventory_quantity": {
                if (!(await hasAccessToFeature(userObjectId, "inventory"))) {
                  twiml.message(
                    "🚫 A funcionalidade de controle de estoque está disponível apenas no plano Diamante."
                  );
                  break;
                }
                let { quantity, productId } = interpretation.data;
                if (quantity === undefined || !productId) {
                  twiml.message(
                    "Formato incorreto. Use: entrada/saída [quantidade] #[ID]. Ex: *vendi 2 #P0001*"
                  );
                  break;
                }
                productId = productId.toUpperCase();

                const product = await Product.findOne({
                  userId: userIdString,
                  customId: productId,
                });

                if (!product) {
                  twiml.message(
                    `🚫 Não encontrei produto com o ID *#${productId}*.`
                  );
                  break;
                }

                if (quantity < 0 && product.quantity < Math.abs(quantity)) {
                  twiml.message(
                    `⚠️ *Operação não permitida!*\n\nVocê tentou dar saída de ${Math.abs(
                      quantity
                    )} unidades, mas só há ${product.quantity} em estoque.`
                  );
                  break;
                }

                const updatedProduct = await Product.findOneAndUpdate(
                  { _id: product._id },
                  { $inc: { quantity: quantity } },
                  { new: true }
                );

                const movementType = quantity > 0 ? "Entrada" : "Saída";

                const productName = Object.values(
                  Object.fromEntries(updatedProduct.attributes)
                ).join(" ");

                let responseMessage = `✅ *${movementType} registrada!*\n\n*Produto:* ${productName} (#${updatedProduct.customId})\n*Estoque Atual:* ${updatedProduct.quantity} unidades.`;
                twiml.message(responseMessage);

                if (updatedProduct.quantity <= updatedProduct.minStockLevel) {
                  setTimeout(() => {
                    const alertMessage = `⚠️ *Alerta de Estoque Baixo!*\n\nO produto *${productName}* (#${updatedProduct.customId}) atingiu o nível mínimo.\n\n*Quantidade Atual:* ${updatedProduct.quantity}`;
                    sendTextMessage(req.body.From, alertMessage);
                  }, 1000);
                }

                break;
              }
              case "set_inventory_alert": {
                if (!(await hasAccessToFeature(userObjectId, "inventory"))) {
                  twiml.message(
                    "🚫 A funcionalidade de controle de estoque está disponível apenas no plano Diamante."
                  );
                  break;
                }

                let { productId, quantity } = interpretation.data;

                if (quantity === undefined || !productId) {
                  twiml.message(
                    "Formato incorreto. Use: definir alerta #[ID] para [quantidade]. Ex: *alerta #P0001 para 10*"
                  );
                  break;
                }

                productId = productId.toUpperCase();

                const product = await Product.findOne({
                  userId: userIdString,
                  customId: productId,
                });

                if (!product) {
                  twiml.message(
                    `🚫 Não encontrei produto com o ID *#${productId}*.`
                  );
                  break;
                }

                await Product.updateOne(
                  { _id: product._id },
                  { $set: { minStockLevel: quantity } }
                );

                const productName = Object.values(
                  Object.fromEntries(product.attributes)
                ).join(" ");

                twiml.message(
                  `✅ Alerta para o produto *${productName}* (#${productId}) definido para *${quantity} unidades*.`
                );

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
          }
        } catch (err) {
          devLog("Erro ao interpretar a mensagem:", err);
          sendHelpMessage(twiml);
        }
      }
    }
    if (!responseHasBeenSent) {
      const twilioResponse = twiml.toString(); // Salva a resposta em uma variável
      devLog("Resposta final do Twilio:", twilioResponse); // Log para depuração
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twilioResponse); // Envia a variável
    }
  }
});

export default router;
