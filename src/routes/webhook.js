import express from "express";
import crypto from "crypto";
import {
  sendTextMessage,
  sendTextMessageTEST,
} from "../services/whatsappService.js";
import { sendCloudApiMessage } from "../helpers/cloudApiMessageHelper.js";
import { devLog, structuredLogger } from "../helpers/logger.js";
import { generateCorrelationId } from "../helpers/logger.js";
import User from "../models/User.js";
import { fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "../utils/dateUtils.js";
import cloudApiConfig from "../config/cloudApiConfig.js";

import {
  interpretMessageWithAI,
  transcribeAudioWithWhisper,
  interpretDocumentWithAI,
} from "../services/aiService.js";
import { audioMessageHandler } from "../services/audioMessageHandler.js";
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
  sendTotalIncomeMessage,
  sendTotalExpenseMessage,
  sendFinancialHelpMessage,
  sendReminderMessage,
  sendTotalRemindersMessage,
  sendReminderDeletedMessage,
  sendAudioProcessingMessage,
  getAudioErrorMessage,
  AUDIO_ERROR_MESSAGES,
} from "../helpers/messages.js";
import {
  VALID_CATEGORIES,
  VALID_CATEGORIES_INCOME,
} from "../utils/constants.js";
import { hasAccessToFeature } from "../helpers/userUtils.js";
import Reminder from "../models/Reminder.js";
import { fixPhoneNumber } from "../utils/phoneUtils.js";
import { validateUserAccess } from "../services/userAccessService.js";
import reminderService from "../services/reminderService.js";
import googleIntegrationWhatsAppService from "../services/googleIntegrationWhatsAppService.js";

const router = express.Router();
let conversationState = {};

/**
 * GET endpoint for WhatsApp Cloud API webhook verification
 * This endpoint is called by WhatsApp to verify the webhook URL
 */
router.get("/", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    structuredLogger.info("Webhook verification request received", {
      mode,
      tokenProvided: !!token,
      challengeProvided: !!challenge,
      userAgent: req.get("User-Agent"),
      ip: req.ip,
    });

    // Verify that this is a webhook verification request
    if (mode !== "subscribe") {
      structuredLogger.warn("Invalid webhook verification mode", { mode });
      return res.status(400).json({
        error: 'Invalid mode. Expected "subscribe"',
        received: mode,
      });
    }

    // Verify the webhook token matches our configured token
    const expectedToken = cloudApiConfig.getConfig().webhookVerifyToken;
    if (!expectedToken) {
      structuredLogger.error("Webhook verify token not configured");
      return res.status(500).json({
        error: "Webhook verification token not configured",
      });
    }

    if (token !== expectedToken) {
      structuredLogger.warn("Webhook verification failed - token mismatch", {
        expectedLength: expectedToken.length,
        receivedLength: token ? token.length : 0,
      });
      return res.status(403).json({
        error: "Webhook verification failed - invalid token",
      });
    }

    // Verification successful - return the challenge
    structuredLogger.info("Webhook verification successful", {
      challenge: challenge?.substring(0, 10) + "...", // Log partial challenge for debugging
    });

    return res.status(200).send(challenge);
  } catch (error) {
    structuredLogger.error("Error during webhook verification", {
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      error: "Internal server error during webhook verification",
    });
  }
});

/**
 * Verify webhook signature for incoming Cloud API requests
 * This function validates that the request actually came from WhatsApp
 */
function verifyWebhookSignature(req) {
  try {
    const signature = req.get("X-Hub-Signature-256");
    if (!signature) {
      structuredLogger.warn("Missing webhook signature header");
      return false;
    }

    // Extract the signature hash (remove 'sha256=' prefix)
    const signatureHash = signature.replace("sha256=", "");

    // Get the webhook verify token for signature verification
    const webhookSecret = cloudApiConfig.getConfig().webhookVerifyToken;
    if (!webhookSecret) {
      structuredLogger.error(
        "Webhook secret not configured for signature verification"
      );
      return false;
    }

    // Calculate expected signature
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(req.rawBody || JSON.stringify(req.body))
      .digest("hex");

    // Compare signatures using timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signatureHash, "hex"),
      Buffer.from(expectedSignature, "hex")
    );

    if (!isValid) {
      structuredLogger.warn("Webhook signature verification failed", {
        signatureProvided: !!signature,
        expectedLength: expectedSignature.length,
        receivedLength: signatureHash.length,
      });
    }

    return isValid;
  } catch (error) {
    structuredLogger.error("Error verifying webhook signature", {
      error: error.message,
      hasSignature: !!req.get("X-Hub-Signature-256"),
    });
    return false;
  }
}

/**
 * Middleware to capture raw body for signature verification
 */
function captureRawBody(req, res, next) {
  let data = "";
  req.setEncoding("utf8");

  req.on("data", (chunk) => {
    data += chunk;
  });

  req.on("end", () => {
    req.rawBody = data;
    next();
  });
}

router.post("/", async (req, res) => {
  // Check if this is a Cloud API webhook request
  const isCloudApiRequest =
    req.body.object === "whatsapp_business_account" ||
    req.get("X-Hub-Signature-256") ||
    req.body.entry;

  if (isCloudApiRequest) {
    // Handle Cloud API webhook format
    return handleCloudApiWebhook(req, res);
  }

  // If we reach here, it's not a Cloud API request
  res.status(400).json({ error: 'Invalid webhook request format' });
});

/**
 * Handle Cloud API webhook requests
 */
async function handleCloudApiWebhook(req, res) {
  try {
    structuredLogger.info('Cloud API webhook received', {
      body: JSON.stringify(req.body, null, 2),
      headers: {
        'X-Hub-Signature-256': req.get('X-Hub-Signature-256'),
        'Content-Type': req.get('Content-Type')
      }
    });
    
    console.log('🔍 WEBHOOK DEBUG - Payload completo:');
    console.log(JSON.stringify(req.body, null, 2));

    // Temporarily skip signature verification for debugging
    // TODO: Re-enable signature verification in production
    /*
    if (!verifyWebhookSignature(req)) {
      structuredLogger.warn('Invalid webhook signature for Cloud API request');
      return res.status(403).json({ error: 'Invalid signature' });
    }
    */

    // Process webhook payload
    const { entry } = req.body;
    
    if (!entry || !Array.isArray(entry)) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Process each entry
    for (const entryItem of entry) {
      if (entryItem.changes) {
        for (const change of entryItem.changes) {
          if (change.field === 'messages' && change.value.messages) {
            for (const message of change.value.messages) {
              await processSingleCloudApiMessage(
                message, 
                change.value.contacts, 
                change.value.metadata
              );
            }
          }
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    structuredLogger.error('Error processing Cloud API webhook', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Process message using existing logic (Cloud API)
 */
async function processMessageWithExistingLogic(
  req,
  isImage,
  userMessage,
  userPhoneNumber,
  messageId = null
) {
  try {
    let responseHasBeenSent = false;

    if ((!userMessage || userMessage.trim() === "") && !isImage) {
      return; // Skip empty messages
    }

    console.log('🔍 PROCESS DEBUG - Iniciando processamento:');
    console.log('UserPhoneNumber:', userPhoneNumber);
    console.log('UserMessage:', userMessage);
    console.log('IsImage:', isImage);
    
    devLog(`Mensagem de ${userPhoneNumber} para processar: "${userMessage}"`);

    const { authorized, user } = await validateUserAccess(userPhoneNumber);

    if (!authorized) {
      // For Cloud API, we need to send response via Cloud API service
      const unauthorizedMessage = `Poxa 🥲, infelizmente o seu teste ou assinatura acabou.🔒

Para continuar utilizando a sua assistente financeira e continuar deixando o seu financeiro organizado na palma da sua mão 💸, acesse o link abaixo e garante já o seu plano: adapfinanceira.com.br/planos`;

      await sendCloudApiResponse(userPhoneNumber, unauthorizedMessage);
      return;
    }

    const userObjectId = user._id;
    const userIdString = user._id.toString();
    console.log("userIdString: ", userIdString);
    devLog(`User DB ID: ${userIdString}`);

    const previousData = conversationState[userIdString] || {};
    const userStats = await UserStats.findOne(
      { userId: userObjectId },
      { blocked: 1 }
    );

    if (userStats?.blocked) {
      await sendCloudApiResponse(
        userPhoneNumber,
        "🚫 Você está bloqueado de usar a ADAP."
      );
      return;
    }

    const generateId = customAlphabet("1234567890abcdef", 8);
    const generateGroupId = customAlphabet(
      "1234567890abcdefghijklmnopqrstuvwxyz",
      22
    );

    // Continue with existing message processing logic...
    // The rest of the logic will be handled by the existing POST route processing
    // We'll create a mock response object to capture the responses
    const mockRes = {
      responses: [],
      writeHead: () => {},
      end: (content) => {
        // Extract messages from TwiML and send via Cloud API
        if (content) {
          extractAndSendTwimlResponses(content, userPhoneNumber);
        }
      },
    };

    // Create a mock TwiML object that captures responses
    const mockTwiml = {
      messages: [],
      message: function (text) {
        this.messages.push(text);
        return this;
      },
      toString: function () {
        return this.messages.join("\n");
      },
    };

    // Process the message with existing logic adapted for Cloud API
    await processMessageForCloudApi(
      req,
      mockTwiml,
      userMessage,
      isImage,
      userPhoneNumber,
      userObjectId,
      userIdString,
      previousData,
      generateId,
      generateGroupId
    );

    // Send all collected responses via Cloud API
    structuredLogger.info("Sending collected TwiML messages", {
      messageCount: mockTwiml.messages.length,
      messages: mockTwiml.messages,
      userPhoneNumber
    });
    
    for (const message of mockTwiml.messages) {
      await sendCloudApiResponse(userPhoneNumber, message);
    }
  } catch (error) {
    structuredLogger.error("Error in processMessageWithExistingLogic", {
      error: error.message,
      userPhoneNumber,
      messageId,
    });
    await sendCloudApiResponse(
      userPhoneNumber,
      "❌ Ocorreu um erro ao processar sua mensagem. Tente novamente."
    );
  }
}

/**
 * Send response via Cloud API
 */
async function sendCloudApiResponse(to, message) {
  try {
    structuredLogger.info("sendCloudApiResponse called", {
      to,
      message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      messageLength: message.length
    });

    // Check if Cloud API is enabled
    if (!cloudApiConfig.isEnabled() && !cloudApiConfig.isMigrationMode()) {
      // Cloud API is required
      await sendTextMessage(to, message);
      return;
    }

    // Import Cloud API service dynamically to avoid circular dependencies
    const { CloudApiService } = await import("../services/cloudApiService.js");
    const cloudApiService = new CloudApiService();

    // Remove 'whatsapp:' prefix if present for Cloud API
    const phoneNumber = to.replace("whatsapp:", "").replace("+", "");

    structuredLogger.info("Sending message via Cloud API", {
      originalTo: to,
      formattedPhoneNumber: phoneNumber,
      messagePreview: message.substring(0, 50) + '...'
    });

    await cloudApiService.sendTextMessage(phoneNumber, message);

    structuredLogger.info("Cloud API response sent successfully", {
      to: phoneNumber,
      messageLength: message.length,
    });
  } catch (error) {
    structuredLogger.error("Error sending Cloud API response", {
      error: error.message,
      to,
      messageLength: message?.length,
    });

    // Handle Cloud API errors
    try {
      await sendTextMessage(to, message);
    } catch (fallbackError) {
      structuredLogger.error("Cloud API message sending failed", {
        error: fallbackError.message,
        to,
      });
    }
  }
}

/**
 * Send audio processing feedback message via Cloud API
 */
async function sendAudioFeedbackMessage(userPhoneNumber, messageType, additionalData = null) {
  try {
    let message;
    
    switch (messageType) {
      case 'PROCESSING':
        message = "🎤 Processando seu áudio... Só um instante.";
        break;
      case 'SUCCESS':
        message = additionalData?.transcription 
          ? `🎤✅ Áudio processado: "${additionalData.transcription.substring(0, 100)}${additionalData.transcription.length > 100 ? '...' : ''}"`
          : "🎤✅ Áudio processado com sucesso!";
        break;
      default:
        message = getAudioErrorMessage(messageType);
    }

    await sendCloudApiResponse(userPhoneNumber, message);

    structuredLogger.info("Audio feedback message sent", {
      userPhoneNumber,
      messageType,
      messageLength: message.length
    });

  } catch (error) {
    structuredLogger.error("Error sending audio feedback message", {
      error: error.message,
      userPhoneNumber,
      messageType
    });
  }
}

/**
 * Process message for Cloud API (adapted from existing logic)
 */
async function processMessageForCloudApi(
  req,
  twiml,
  userMessage,
  isImage,
  userPhoneNumber,
  userObjectId,
  userIdString,
  previousData,
  generateId,
  generateGroupId
) {
  structuredLogger.info("processMessageForCloudApi started", {
    userMessage,
    isImage,
    userPhoneNumber,
    userIdString,
    previousDataAwaiting: previousData.awaiting
  });

  // This function will contain the adapted message processing logic
  // For now, we'll implement a basic version and expand it

  if (isImage) {
    await sendCloudApiMessage(userPhoneNumber, "🔍 Analisando seu documento... Só um instante.");

    try {
      // Handle image processing for Cloud API
      const mediaId = req.body.MediaUrl0;
      if (mediaId) {
        await processCloudApiMedia(
          mediaId,
          userPhoneNumber,
          userIdString,
          userObjectId,
          generateId,
          twiml
        );
      }
    } catch (error) {
      structuredLogger.error("Error processing Cloud API image", {
        error: error.message,
      });
      await sendErrorMessageWithFallback(userPhoneNumber, "❌ Erro ao processar imagem. Tente novamente.", {
        errorType: "IMAGE_PROCESSING_ERROR",
        error: error.message
      });
    }
    return;
  }

  // Handle conversation states
  if (previousData.awaiting === "payment_status_confirmation") {
    const userInput = userMessage.trim().toLowerCase();
    if (userInput !== "sim" && userInput !== "não") {
      await sendCloudApiMessage(userPhoneNumber, "Por favor, responda apenas com `sim` ou `não`.");
    } else {
      // Process payment confirmation logic...
      const hasPaid = userInput === "sim";
      const { totalAmount, provider, dueDate, category } = previousData.payload;

      const status = hasPaid ? "completed" : "pending";
      const date = hasPaid ? new Date() : new Date(`${dueDate}T12:00:00`);
      const description = `Conta ${provider}`;

      const categoryDoc = await getOrCreateCategory(
        userIdString,
        category.toLowerCase()
      );
      const defaultPaymentMethod = await PaymentMethod.findOne({ type: "pix" });

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
          userPhoneNumber: userPhoneNumber.replace("whatsapp:", ""),
          description: `Pagar conta da ${provider} no valor de R$ ${totalAmount.toFixed(
            2
          )}`,
          date: reminderDate,
          messageId: generateId(),
        });
        await newReminder.save();
        // Send response via Cloud API
        await sendCloudApiMessage(userPhoneNumber, 
          `✅ Conta da *${provider}* registrada como *pendente* e lembrete criado para o dia do vencimento!`
        );
      } else {
        // Send response via Cloud API
        await sendCloudApiMessage(userPhoneNumber,
          `✅ Conta da *${provider}* registrada como *paga* com sucesso!`
        );
      }
      delete conversationState[userIdString];
    }
    return;
  }

  // Handle PIX type confirmation
  if (previousData.awaiting === "pix_type_confirmation") {
    const userInput = userMessage.trim().toLowerCase();
    if (userInput !== "fiz" && userInput !== "recebi") {
      await sendCloudApiMessage(userPhoneNumber, "Por favor, responda apenas com `fiz` ou `recebi`.");
    } else {
      // Process PIX confirmation logic...
      const isExpense = userInput === "fiz"; // "fiz" = expense, "recebi" = income
      const { totalAmount, counterpartName } = previousData.payload;

      const transactionType = isExpense ? "expense" : "income";
      const description = isExpense 
        ? `PIX para ${counterpartName}` 
        : `PIX recebido de ${counterpartName}`;

      // Get or create appropriate category
      const categoryName = isExpense ? "transferência" : "receita";
      const categoryDoc = await getOrCreateCategory(userIdString, categoryName);
      const defaultPaymentMethod = await PaymentMethod.findOne({ type: "pix" });

      const newTransaction = new Transaction({
        userId: userIdString,
        amount: totalAmount,
        description,
        categoryId: categoryDoc._id.toString(),
        type: transactionType,
        date: new Date(),
        status: "completed",
        messageId: generateId(),
        paymentMethodId: defaultPaymentMethod._id.toString(),
      });
      await newTransaction.save();

      // Update user stats
      if (isExpense) {
        await UserStats.findOneAndUpdate(
          { userId: userObjectId },
          { $inc: { totalSpent: totalAmount } }
        );
      } else {
        await UserStats.findOneAndUpdate(
          { userId: userObjectId },
          { $inc: { totalReceived: totalAmount } }
        );
      }

      // Send confirmation message
      const confirmationMessage = isExpense
        ? `✅ PIX de *R$ ${totalAmount.toFixed(2)}* para *${counterpartName}* registrado como despesa!`
        : `✅ PIX de *R$ ${totalAmount.toFixed(2)}* de *${counterpartName}* registrado como receita!`;
      
      await sendCloudApiMessage(userPhoneNumber, confirmationMessage);
      
      structuredLogger.info("PIX transaction processed successfully", {
        userPhoneNumber,
        transactionType,
        totalAmount,
        counterpartName,
        transactionId: newTransaction._id.toString()
      });

      delete conversationState[userIdString];
    }
    return;
  }

  // Handle other conversation states and AI interpretation
  structuredLogger.info("Processing message for AI interpretation", {
    userMessage,
    userIdString,
    previousDataAwaiting: previousData.awaiting,
    hasConversationState: !!conversationState[userIdString]
  });

  // Special handling for "apagar item X" when user has list deletion available
  if (userMessage.toLowerCase().trim().startsWith("apagar item") && 
      previousData.awaiting === "list_item_deletion_available") {
    
    // Extract item number from message
    const match = userMessage.match(/apagar item (\d+)/i);
    if (!match) {
      await sendCloudApiResponse(userPhoneNumber,
        "🚫 Formato inválido. Use 'apagar item X' onde X é o número do item."
      );
      return;
    }

    const itemNumber = parseInt(match[1]);
    const { transactionIds, type } = previousData.payload;
    
    if (itemNumber < 1 || itemNumber > transactionIds.length) {
      await sendCloudApiResponse(userPhoneNumber,
        `🚫 Número do item inválido. Escolha um número entre 1 e ${transactionIds.length}.`
      );
      return;
    }

    // Get the transaction ID (itemNumber is 1-based, array is 0-based)
    const transactionId = transactionIds[itemNumber - 1];
    
    const transaction = await Transaction.findOneAndDelete({
      _id: transactionId,
      userId: userIdString,
    });

    if (transaction) {
      // Update user stats
      if (transaction.type === "expense") {
        await UserStats.findOneAndUpdate(
          { userId: userObjectId },
          { $inc: { totalSpent: -transaction.amount } }
        );
        await sendCloudApiResponse(userPhoneNumber,
          `🗑️ Item ${itemNumber} removido: ${transaction.description} - R$ ${transaction.amount.toFixed(2)}`
        );
      } else {
        await UserStats.findOneAndUpdate(
          { userId: userObjectId },
          { $inc: { totalIncome: -transaction.amount } }
        );
        await sendCloudApiResponse(userPhoneNumber,
          `🗑️ Item ${itemNumber} removido: ${transaction.description} - R$ ${transaction.amount.toFixed(2)}`
        );
      }
      
      // Clear conversation state after deletion
      delete conversationState[userIdString];
    } else {
      await sendCloudApiResponse(userPhoneNumber,
        "🚫 Erro ao remover o item. Tente novamente."
      );
    }
    return;
  }

  // Special handling for "detalhes" when user has expense/income details available
  if (userMessage.toLowerCase().trim() === "detalhes" && 
      (previousData.awaiting === "expense_details_available" || previousData.awaiting === "income_details_available")) {
    
    structuredLogger.info("Processing detalhes request", {
      awaiting: previousData.awaiting,
      payload: previousData.payload
    });
    
    if (previousData.awaiting === "expense_details_available") {
      const { month, monthName, category } = previousData.payload;
      const details = await getExpenseDetails(userIdString, month, monthName, category);
      
      structuredLogger.info("Expense details retrieved", {
        messageCount: details.messages.length,
        transactionCount: details.transactionIds.length
      });
      
      // Send each message chunk
      for (const message of details.messages) {
        await sendCloudApiResponse(userPhoneNumber, message);
      }
      
      // Save transaction IDs for potential deletion
      conversationState[userIdString] = {
        awaiting: "list_item_deletion_available",
        payload: { 
          transactionIds: details.transactionIds,
          type: "expense"
        }
      };
      
    } else if (previousData.awaiting === "income_details_available") {
      const { month, monthName, category } = previousData.payload;
      const details = await getIncomeDetails(userIdString, month, monthName, category);
      
      structuredLogger.info("Income details retrieved", {
        messageCount: details.messages.length,
        transactionCount: details.transactionIds.length
      });
      
      // Send each message chunk
      for (const message of details.messages) {
        await sendCloudApiResponse(userPhoneNumber, message);
      }
      
      // Save transaction IDs for potential deletion
      conversationState[userIdString] = {
        awaiting: "list_item_deletion_available",
        payload: { 
          transactionIds: details.transactionIds,
          type: "income"
        }
      };
    }
    return;
  }

  // Process normal messages (either no conversation state, or conversation state that allows normal processing)
  const shouldProcessNormally = !previousData.awaiting || 
    (previousData.awaiting === "list_item_deletion_available" && !userMessage.toLowerCase().trim().startsWith("apagar item")) ||
    (previousData.awaiting === "expense_details_available" && userMessage.toLowerCase().trim() !== "detalhes") ||
    (previousData.awaiting === "income_details_available" && userMessage.toLowerCase().trim() !== "detalhes");
    
  if (shouldProcessNormally) {
    
    // If user sends a different message while in a conversation state, clear the state
    if (previousData.awaiting && 
        ((previousData.awaiting === "list_item_deletion_available" && !userMessage.toLowerCase().trim().startsWith("apagar item")) ||
         (previousData.awaiting === "expense_details_available" && userMessage.toLowerCase().trim() !== "detalhes") ||
         (previousData.awaiting === "income_details_available" && userMessage.toLowerCase().trim() !== "detalhes"))) {
      delete conversationState[userIdString];
    }
    try {
      structuredLogger.info("Calling interpretMessageWithAI", { userMessage });
      
      const interpretation = await interpretMessageWithAI(
        userMessage,
        new Date().toISOString()
      );
      
      structuredLogger.info("AI interpretation result", { 
        intent: interpretation.intent,
        data: interpretation.data 
      });
      const userHasFreeCategorization = await hasAccessToFeature(
        userObjectId,
        "categories"
      );
      devLog("intent:" + interpretation.intent);

      conversationState[userIdString] = {
        ...previousData,
        ...interpretation.data,
      };

      // Handle different intents (same logic as existing implementation)
      switch (interpretation.intent) {
        case "add_income": {
          const { amount, description, category } = interpretation.data;

          if (amount === null || isNaN(amount) || amount <= 0) {
            // Send error message via Cloud API
            await sendCloudApiMessage(userPhoneNumber,
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

          if (amount === null || isNaN(amount) || amount <= 0) {
            // Send error message via Cloud API
            await sendCloudApiMessage(userPhoneNumber,
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

        case "get_total": {
          let { month, monthName, category } = interpretation.data;
          
          // If no month specified, use current month
          if (!month) {
            const now = new Date();
            const year = now.getFullYear();
            const monthNumber = now.getMonth() + 1; // getMonth() returns 0-11
            month = `${year}-${monthNumber.toString().padStart(2, '0')}`;
            
            // Set monthName to current month in Portuguese
            const monthNames = [
              'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
              'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
            ];
            monthName = monthNames[now.getMonth()];
          }
          
          const total = await calculateTotalExpenses(userIdString, category, month);
          sendTotalExpenseMessage(twiml, total, monthName, category);
          
          // Save conversation state for potential "detalhes" request
          conversationState[userIdString] = {
            awaiting: "expense_details_available",
            payload: { month, monthName, category }
          };
          break;
        }

        case "get_total_income": {
          let { month, monthName, category } = interpretation.data;
          
          // If no month specified, use current month
          if (!month) {
            const now = new Date();
            const year = now.getFullYear();
            const monthNumber = now.getMonth() + 1; // getMonth() returns 0-11
            month = `${year}-${monthNumber.toString().padStart(2, '0')}`;
            
            // Set monthName to current month in Portuguese
            const monthNames = [
              'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
              'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
            ];
            monthName = monthNames[now.getMonth()];
          }
          
          const total = await calculateTotalIncome(userIdString, month, category);
          sendTotalIncomeMessage(twiml, total, monthName);
          
          // Save conversation state for potential "detalhes" request
          conversationState[userIdString] = {
            awaiting: "income_details_available",
            payload: { month, monthName, category }
          };
          break;
        }



        case "reminder": {
          const { description, date } = interpretation.data;
          
          if (!description || !date) {
            await sendCloudApiResponse(userPhoneNumber,
              "🚫 Não consegui identificar a descrição ou data do lembrete. Por favor, tente novamente. Ex: 'me lembre de pagar o aluguel dia 5'."
            );
            break;
          }

          const reminderDate = new Date(date);
          const newReminder = new Reminder({
            userId: userObjectId,
            userPhoneNumber: userPhoneNumber,
            description,
            date: reminderDate,
            messageId: generateId(),
          });

          await newReminder.save();
          
          // Create a mock twiml to capture the message
          const mockTwiml = { messages: [] };
          mockTwiml.message = (text) => mockTwiml.messages.push(text);
          
          await sendReminderMessage(mockTwiml, description, newReminder);
          
          // Send the captured message via Cloud API
          for (const message of mockTwiml.messages) {
            await sendCloudApiResponse(userPhoneNumber, message);
          }
          break;
        }

        case "get_total_reminders": {
          const reminders = await getTotalReminders(userObjectId);
          
          // Create a mock twiml to capture the message
          const mockTwiml = { messages: [] };
          mockTwiml.message = (text) => mockTwiml.messages.push(text);
          
          sendTotalRemindersMessage(mockTwiml, reminders);
          
          // Send the captured message via Cloud API
          for (const message of mockTwiml.messages) {
            await sendCloudApiResponse(userPhoneNumber, message);
          }
          break;
        }

        case "delete_reminder": {
          const { messageId } = interpretation.data;
          
          if (!messageId) {
            await sendCloudApiResponse(userPhoneNumber,
              "🚫 Não consegui identificar qual lembrete você quer excluir. Use o código do lembrete, ex: 'apagar lembrete #abc123'."
            );
            break;
          }

          const reminder = await Reminder.findOneAndDelete({
            userId: userObjectId,
            messageId: messageId,
          });

          if (reminder) {
            // Create a mock twiml to capture the message
            const mockTwiml = { messages: [] };
            mockTwiml.message = (text) => mockTwiml.messages.push(text);
            
            sendReminderDeletedMessage(mockTwiml, reminder);
            
            // Send the captured message via Cloud API
            for (const message of mockTwiml.messages) {
              await sendCloudApiResponse(userPhoneNumber, message);
            }
          } else {
            await sendCloudApiResponse(userPhoneNumber,
              "🚫 Lembrete não encontrado. Verifique o código e tente novamente."
            );
          }
          break;
        }

        case "add_installment_expense": {
          const { totalAmount, description, installments, category } = interpretation.data;

          if (!totalAmount || !installments || totalAmount <= 0 || installments <= 0) {
            await sendCloudApiResponse(userPhoneNumber,
              "🚫 Não consegui identificar o valor total ou número de parcelas. Ex: '3500 PS5 em 10x'."
            );
            break;
          }

          let finalCategoryName = category || "outro";
          if (!VALID_CATEGORIES.includes(finalCategoryName) && !userHasFreeCategorization) {
            finalCategoryName = "outro";
          }

          const categoryDoc = await getOrCreateCategory(userIdString, finalCategoryName);
          const defaultPaymentMethod = await PaymentMethod.findOne({ type: "pix" });
          const installmentGroupId = generateGroupId();
          const installmentAmount = totalAmount / installments;

          // Create all installments
          for (let i = 1; i <= installments; i++) {
            const installmentDate = new Date();
            installmentDate.setMonth(installmentDate.getMonth() + (i - 1));

            const newInstallment = new Transaction({
              userId: userIdString,
              amount: installmentAmount,
              description: `${description} (${i}/${installments})`,
              categoryId: categoryDoc._id.toString(),
              type: "expense",
              date: installmentDate,
              messageId: generateId(),
              paymentMethodId: defaultPaymentMethod._id.toString(),
              status: i === 1 ? "completed" : "pending",
              installmentsCount: installments,
              installmentsCurrent: i,
              installmentsGroupId: installmentGroupId,
            });

            await newInstallment.save();
          }

          await UserStats.findOneAndUpdate(
            { userId: userObjectId },
            { $inc: { totalSpent: installmentAmount } }, // Only count first installment
            { upsert: true }
          );

          await sendCloudApiResponse(userPhoneNumber,
            `📝 *Parcelamento criado*\n📌 ${description.toUpperCase()}\n💰 *${installments}x de R$ ${installmentAmount.toFixed(2)}*\n💳 *Total: R$ ${totalAmount.toFixed(2)}*\n\n📅 Primeira parcela já debitada - #${installmentGroupId}`
          );
          break;
        }

        case "get_active_installments": {
          const installments = await getActiveInstallments(userIdString);
          
          if (!installments || installments.length === 0) {
            await sendCloudApiResponse(userPhoneNumber, 
              "📋 Você não possui parcelamentos ativos no momento."
            );
            break;
          }
          
          let message = "💳 *Seus parcelamentos ativos:*\n\n";
          
          installments.forEach((installment, index) => {
            const totalAmount = installment.installmentAmount * installment.totalInstallments;
            message += `${index + 1}. **${installment.description.toUpperCase()}**\n`;
            message += `   💰 ${installment.totalInstallments}x de R$ ${installment.installmentAmount.toFixed(2)}\n`;
            message += `   📊 Total: R$ ${totalAmount.toFixed(2)}\n`;
            message += `   ⏳ Restam: ${installment.pendingCount} parcelas\n`;
            message += `   🆔 ID: #${installment.groupId}\n\n`;
          });
          
          message += "Para cancelar um parcelamento, envie: *cancelar parcelamento #ID*";
          
          await sendCloudApiResponse(userPhoneNumber, message);
          break;
        }

        case "delete_transaction": {
          const { messageId } = interpretation.data;
          
          if (!messageId) {
            await sendCloudApiResponse(userPhoneNumber,
              "🚫 Não consegui identificar qual transação você quer excluir. Use o código da transação, ex: 'remover gasto #abc123'."
            );
            break;
          }

          const transaction = await Transaction.findOneAndDelete({
            userId: userIdString,
            messageId: messageId,
          });

          if (transaction) {
            // Update user stats
            if (transaction.type === "expense") {
              await UserStats.findOneAndUpdate(
                { userId: userObjectId },
                { $inc: { totalSpent: -transaction.amount } }
              );
              sendExpenseDeletedMessage(twiml, transaction);
            } else {
              await UserStats.findOneAndUpdate(
                { userId: userObjectId },
                { $inc: { totalIncome: -transaction.amount } }
              );
              sendIncomeDeletedMessage(twiml, transaction);
            }
          } else {
            await sendCloudApiResponse(userPhoneNumber,
              "🚫 Transação não encontrada. Verifique o código e tente novamente."
            );
          }
          break;
        }



        case "generate_daily_chart": {
          const { days } = interpretation.data;
          const numDays = days || 7; // Default to 7 days if not specified
          
          try {
            const expenses = await getExpensesReport(userIdString, numDays);
            
            if (!expenses || expenses.length === 0) {
              await sendCloudApiResponse(userPhoneNumber,
                `📊 Não há gastos registrados nos últimos ${numDays} dias.`
              );
              break;
            }
            
            const imageUrl = await generateChart(expenses, userIdString, numDays);
            
            // Send image via Cloud API
            const { CloudApiService } = await import("../services/cloudApiService.js");
            const cloudApiService = new CloudApiService();
            const phoneNumber = userPhoneNumber.replace("whatsapp:", "").replace("+", "");
            
            await cloudApiService.sendMediaMessage(phoneNumber, imageUrl, `📊 Relatório de gastos dos últimos ${numDays} dias`);
            
          } catch (error) {
            structuredLogger.error("Error generating daily chart", {
              error: error.message,
              userIdString,
              days: numDays
            });
            await sendCloudApiResponse(userPhoneNumber,
              "❌ Erro ao gerar o relatório. Tente novamente em alguns instantes."
            );
          }
          break;
        }

        case "generate_category_chart": {
          const { days } = interpretation.data;
          const numDays = days || 30; // Default to 30 days if not specified
          
          try {
            const expenses = await getCategoryReport(userIdString, numDays);
            
            if (!expenses || expenses.length === 0) {
              await sendCloudApiResponse(userPhoneNumber,
                `📊 Não há gastos registrados nos últimos ${numDays} dias.`
              );
              break;
            }
            
            const imageUrl = await generateCategoryChart(expenses, userIdString);
            
            // Send image via Cloud API
            const { CloudApiService } = await import("../services/cloudApiService.js");
            const cloudApiService = new CloudApiService();
            const phoneNumber = userPhoneNumber.replace("whatsapp:", "").replace("+", "");
            
            await cloudApiService.sendMediaMessage(phoneNumber, imageUrl, `📊 Relatório de gastos por categoria dos últimos ${numDays} dias`);
            
          } catch (error) {
            structuredLogger.error("Error generating category chart", {
              error: error.message,
              userIdString,
              days: numDays
            });
            await sendCloudApiResponse(userPhoneNumber,
              "❌ Erro ao gerar o relatório. Tente novamente em alguns instantes."
            );
          }
          break;
        }

        case "generate_income_category_chart": {
          const { days } = interpretation.data;
          const numDays = days || 30; // Default to 30 days if not specified
          
          try {
            const incomeData = await getIncomeByCategoryReport(userIdString, numDays);
            
            if (!incomeData || incomeData.length === 0) {
              await sendCloudApiResponse(userPhoneNumber,
                `📊 Não há receitas registradas nos últimos ${numDays} dias.`
              );
              break;
            }
            
            const imageUrl = await generateIncomeChart(incomeData, userIdString);
            
            // Send image via Cloud API
            const { CloudApiService } = await import("../services/cloudApiService.js");
            const cloudApiService = new CloudApiService();
            const phoneNumber = userPhoneNumber.replace("whatsapp:", "").replace("+", "");
            
            await cloudApiService.sendMediaMessage(phoneNumber, imageUrl, `📊 Relatório de receitas por categoria dos últimos ${numDays} dias`);
            
          } catch (error) {
            structuredLogger.error("Error generating income chart", {
              error: error.message,
              userIdString,
              days: numDays
            });
            await sendCloudApiResponse(userPhoneNumber,
              "❌ Erro ao gerar o relatório. Tente novamente em alguns instantes."
            );
          }
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

/**
 * Process a single Cloud API message
 */
async function processSingleCloudApiMessage(message, contacts, metadata) {
  try {
    console.log('🔍 PROCESSSINGLE DEBUG - Mensagem recebida:');
    console.log('Message:', JSON.stringify(message, null, 2));
    console.log('Contacts:', JSON.stringify(contacts, null, 2));
    console.log('Metadata:', JSON.stringify(metadata, null, 2));
    
    structuredLogger.info("processSingleCloudApiMessage called", {
      message,
      contacts,
      metadata
    });

    const { id, from, timestamp, type, text, image, audio, document } = message;

    // Skip status messages and other non-user messages
    if (!from || !type) {
      structuredLogger.debug("Skipping non-user message", { id, type });
      return;
    }

    structuredLogger.info("Processing Cloud API message", {
      messageId: id,
      from,
      type,
      timestamp,
    });

    // Extract user message content based on message type
    let userMessage = "";
    let isImage = false;
    let mediaUrl = null;

    switch (type) {
      case "text":
        userMessage = text?.body || "";
        break;

      case "image":
        isImage = true;
        mediaUrl = image?.id; // Cloud API provides media ID, not direct URL
        userMessage = image?.caption || "";
        break;

      case "audio":
        mediaUrl = audio?.id;
        userMessage = "[Audio message]"; // Will be transcribed in processing
        break;

      case "document":
        isImage = true; // Treat documents as images for processing
        mediaUrl = document?.id;
        userMessage = document?.caption || "[Document received]";
        break;

      default:
        structuredLogger.info("Unsupported message type", {
          type,
          messageId: id,
        });
        return;
    }

    // Format phone number for compatibility with existing system
    // For database lookup, use the number as received (without prefixes)
    // For legacy compatibility, also create the whatsapp: format
    const userPhoneNumber = from; // Use the number as received from WhatsApp
    const legacyPhoneNumber = `whatsapp:+${from}`; // For legacy compatibility

    structuredLogger.info("Formatted Cloud API message for processing", {
      messageId: id,
      userPhoneNumber,
      messageType: type,
      hasMedia: !!mediaUrl,
      messageLength: userMessage.length,
    });

    // Handle audio messages with AudioMessageHandler
    if (type === "audio") {
      await processAudioMessageWithHandler(
        mediaUrl,
        userPhoneNumber,
        id
      );
      return;
    }

    // Create a mock request object compatible with existing processing logic
    const mockReq = {
      body: {
        From: userPhoneNumber,
        Body: userMessage,
        MediaUrl0: mediaUrl, // This will be the media ID for Cloud API
        MediaContentType0: isImage
          ? "image/jpeg"
          : type === "audio"
          ? "audio/ogg"
          : "application/octet-stream",
      },
      cloudApiMessage: {
        id,
        type,
        timestamp,
        originalMessage: message,
      },
    };

    // Process the message using existing logic
    await processMessageWithExistingLogic(
      mockReq,
      isImage,
      userMessage,
      userPhoneNumber,
      id
    );
  } catch (error) {
    structuredLogger.error("Error processing single Cloud API message", {
      error: error.message,
      messageId: message?.id,
      from: message?.from,
    });
  }
}

/**
 * Process audio message using AudioMessageHandler
 */
async function processAudioMessageWithHandler(audioId, userPhoneNumber, messageId) {
  try {
    structuredLogger.info("Processing audio message with AudioMessageHandler", {
      audioId,
      userPhoneNumber,
      messageId
    });

    // Send processing feedback to user using standardized message
    await sendAudioFeedbackMessage(userPhoneNumber, 'PROCESSING');

    // Import Cloud API service
    const { CloudApiService } = await import("../services/cloudApiService.js");
    const cloudApiService = new CloudApiService();

    // Process audio with AudioMessageHandler
    const transcription = await audioMessageHandler.processAudioMessage(
      audioId,
      cloudApiService
    );

    structuredLogger.info("Audio transcription completed", {
      audioId,
      userPhoneNumber,
      messageId,
      transcriptionLength: transcription.length,
      transcriptionPreview: transcription.substring(0, 50) + (transcription.length > 50 ? '...' : '')
    });

    // Create a mock request object for processing the transcribed text
    const mockReq = {
      body: {
        From: userPhoneNumber,
        Body: transcription,
        MediaUrl0: null,
        MediaContentType0: null,
      },
      cloudApiMessage: {
        id: messageId,
        type: "text",
        timestamp: new Date().toISOString(),
        originalMessage: { type: "audio", transcription },
      },
    };

    // Process the transcribed text as a regular message
    await processMessageWithExistingLogic(
      mockReq,
      false, // isImage = false
      transcription,
      userPhoneNumber,
      messageId
    );

  } catch (error) {
    structuredLogger.error("Error processing audio message with handler", {
      error: error.message,
      audioId,
      userPhoneNumber,
      messageId,
      errorType: error.constructor.name,
      errorCode: error.errorType || 'UNKNOWN_ERROR'
    });

    // Determine appropriate error message based on error type
    let errorMessage;
    
    if (error.userMessage) {
      // Use the user-friendly message from AudioProcessingError
      errorMessage = error.userMessage;
    } else if (error.errorType) {
      // Use standardized error messages
      errorMessage = getAudioErrorMessage(error.errorType);
    } else {
      // Fallback to analyzing error message content
      if (error.message.includes('timeout')) {
        errorMessage = getAudioErrorMessage('PROCESSING_TIMEOUT');
      } else if (error.message.includes('network') || error.message.includes('download')) {
        errorMessage = getAudioErrorMessage('NETWORK_ERROR');
      } else if (error.message.includes('format') || error.message.includes('unsupported')) {
        errorMessage = getAudioErrorMessage('UNSUPPORTED_FORMAT');
      } else if (error.message.includes('size') || error.message.includes('large')) {
        errorMessage = getAudioErrorMessage('FILE_TOO_LARGE');
      } else if (error.message.includes('OpenAI') || error.message.includes('API')) {
        errorMessage = getAudioErrorMessage('SERVICE_UNAVAILABLE');
      } else {
        errorMessage = getAudioErrorMessage('UNKNOWN_ERROR');
      }
    }

    await sendCloudApiResponse(userPhoneNumber, errorMessage);
  }
}

/**
 * Process Cloud API media messages (images, documents, etc.)
 */
async function processCloudApiMedia(
  mediaId,
  userPhoneNumber,
  userIdString,
  userObjectId,
  generateId,
  twiml
) {
  try {
    structuredLogger.info("Processing Cloud API media", {
      mediaId,
      userPhoneNumber,
      userIdString,
    });

    // Import Cloud API service
    const { default: CloudApiService } = await import(
      "../services/cloudApiService.js"
    );
    const cloudApiService = new CloudApiService();

    // Download and validate media
    const mediaData = await cloudApiService.downloadMedia(mediaId);
    const validation = cloudApiService.validateMediaContent(
      mediaData.content,
      mediaData.mimeType
    );

    if (!validation.isValid) {
      structuredLogger.warn("Invalid media content", {
        mediaId,
        errors: validation.errors,
      });
      await sendErrorMessageWithFallback(userPhoneNumber, `❌ Arquivo inválido: ${validation.errors.join(", ")}`, {
        errorType: "INVALID_MEDIA_CONTENT",
        mediaId,
        errors: validation.errors
      });
      return;
    }

    const mediaType = validation.metadata.type;
    structuredLogger.info("Media validated successfully", {
      mediaId,
      mediaType,
      fileSize: validation.metadata.size,
      mimeType: validation.metadata.mimeType,
    });

    // Process based on media type
    switch (mediaType) {
      case "image":
        await processCloudApiImage(
          mediaData,
          userPhoneNumber,
          userIdString,
          userObjectId,
          generateId,
          twiml
        );
        break;

      case "document":
        await processCloudApiDocument(
          mediaData,
          userPhoneNumber,
          userIdString,
          userObjectId,
          generateId,
          twiml
        );
        break;

      case "audio":
        await processCloudApiAudio(
          mediaData,
          userPhoneNumber,
          userIdString,
          userObjectId,
          generateId,
          twiml
        );
        break;

      default:
        // Send message via Cloud API
        await sendErrorMessageWithFallback(userPhoneNumber,
          `📄 Tipo de arquivo ${mediaType} recebido, mas processamento específico ainda não implementado.`,
          {
            errorType: "UNSUPPORTED_MEDIA_TYPE",
            mediaType,
            mediaId
          }
        );
        structuredLogger.info("Unsupported media type for processing", {
          mediaType,
          mediaId,
        });
    }
  } catch (error) {
    structuredLogger.error("Error processing Cloud API media", {
      error: error.message,
      mediaId,
      userPhoneNumber,
    });
    // Send error message via Cloud API
    await sendErrorMessageWithFallback(userPhoneNumber,
      "❌ Erro ao processar arquivo. Tente novamente ou envie um arquivo diferente.",
      {
        errorType: "MEDIA_PROCESSING_ERROR",
        mediaId,
        error: error.message
      }
    );
  }
}

/**
 * Handle image processing errors with specific error scenarios
 */
async function handleImageProcessingError(error, userPhoneNumber, mediaData, tempMediaUrl) {
  const errorContext = {
    userPhoneNumber,
    mediaId: mediaData?.id,
    mimeType: mediaData?.mimeType,
    errorMessage: error.message,
    errorStack: error.stack
  };

  let userMessage = "❌ Erro ao processar imagem. Tente novamente.";
  let logLevel = "error";

  try {
    // Classify error type and provide specific handling
    if (error.message?.includes('MIME type') || error.message?.includes('mime')) {
      // AI service MIME type errors
      userMessage = "🚫 Formato de arquivo não suportado. Envie uma imagem JPG, PNG ou PDF.";
      logLevel = "warn";
      errorContext.errorType = "MIME_TYPE_ERROR";
      
    } else if (error.message?.includes('OpenAI') || error.message?.includes('AI service')) {
      // OpenAI API failures
      userMessage = "🤖 Serviço de análise temporariamente indisponível. Tente novamente em alguns minutos.";
      errorContext.errorType = "AI_SERVICE_ERROR";
      
    } else if (error.message?.includes('database') || error.message?.includes('Transaction') || 
               error.message?.includes('UserStats') || error.message?.includes('save')) {
      // Database operation errors
      userMessage = "💾 Erro ao salvar dados. Sua transação foi processada mas pode não ter sido salva. Verifique seu histórico.";
      errorContext.errorType = "DATABASE_ERROR";
      
    } else if (error.message?.includes('Cloud API') || error.message?.includes('sendCloudApiMessage')) {
      // Cloud API message sending errors
      userMessage = "📱 Erro ao enviar resposta. Sua imagem foi processada mas a confirmação pode não ter chegado.";
      errorContext.errorType = "CLOUD_API_MESSAGE_ERROR";
      
    } else if (error.message?.includes('createTempMediaUrl') || error.message?.includes('media')) {
      // Media processing errors
      userMessage = "📁 Erro ao processar arquivo. Verifique se a imagem não está corrompida e tente novamente.";
      errorContext.errorType = "MEDIA_PROCESSING_ERROR";
      
    } else if (error.message?.includes('timeout') || error.message?.includes('TIMEOUT')) {
      // Timeout errors
      userMessage = "⏱️ Processamento demorou muito. Tente com uma imagem menor ou mais nítida.";
      errorContext.errorType = "TIMEOUT_ERROR";
      
    } else {
      // Unknown errors
      errorContext.errorType = "UNKNOWN_ERROR";
      userMessage = "❌ Erro inesperado ao processar imagem. Tente uma foto mais nítida ou entre em contato com o suporte.";
    }

    // Log error with appropriate level
    if (logLevel === "warn") {
      structuredLogger.warn("Image processing error (recoverable)", errorContext);
    } else {
      structuredLogger.error("Image processing error", errorContext);
    }

    // Attempt to send error message to user with fallback handling
    await sendErrorMessageWithFallback(userPhoneNumber, userMessage, errorContext);

  } catch (errorHandlingError) {
    // If error handling itself fails, log it but don't throw
    structuredLogger.error("Error in image processing error handler", {
      originalError: error.message,
      errorHandlingError: errorHandlingError.message,
      userPhoneNumber,
      mediaId: mediaData?.id
    });
  } finally {
    // Always attempt cleanup, even if error handling fails
    if (tempMediaUrl) {
      try {
        await cleanupTempMediaUrl(tempMediaUrl);
        structuredLogger.info("Cleanup completed after error", {
          userPhoneNumber,
          mediaId: mediaData?.id
        });
      } catch (cleanupError) {
        structuredLogger.warn("Failed to cleanup temp media after error", {
          cleanupError: cleanupError.message,
          userPhoneNumber,
          mediaId: mediaData?.id
        });
      }
    }
  }
}

/**
 * Send error message with fallback handling and comprehensive logging
 */
async function sendErrorMessageWithFallback(userPhoneNumber, message, errorContext) {
  const messageAttemptId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  structuredLogger.info("Attempting to send error message", {
    messageAttemptId,
    userPhoneNumber,
    messageLength: message.length,
    errorType: errorContext.errorType,
    originalError: errorContext.errorMessage
  });

  try {
    await sendCloudApiMessage(userPhoneNumber, message);
    
    structuredLogger.info("Error message sent successfully via Cloud API", {
      messageAttemptId,
      userPhoneNumber,
      messageLength: message.length,
      errorType: errorContext.errorType,
      method: "CloudAPI"
    });
    
  } catch (messagingError) {
    // If Cloud API message sending fails, log the failure with detailed context
    structuredLogger.error("Failed to send error message via Cloud API", {
      messageAttemptId,
      messagingError: messagingError.message,
      messagingErrorType: messagingError.errorType || "UNKNOWN",
      originalErrorType: errorContext.errorType,
      userPhoneNumber,
      attemptedMessage: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      fallbackAttempt: true
    });

    // Try fallback to legacy messaging if available
    try {
      const fallbackPhoneNumber = userPhoneNumber.startsWith('whatsapp:') 
        ? userPhoneNumber 
        : `whatsapp:${userPhoneNumber}`;
        
      await sendTextMessage(fallbackPhoneNumber, message);
      
      structuredLogger.info("Error message sent via fallback method", {
        messageAttemptId,
        userPhoneNumber,
        errorType: errorContext.errorType,
        method: "Fallback",
        fallbackPhoneNumber
      });
      
    } catch (fallbackError) {
      // Log complete failure with all error details
      structuredLogger.error("All message sending methods failed - user will not receive error notification", {
        messageAttemptId,
        cloudApiError: {
          message: messagingError.message,
          type: messagingError.errorType || "UNKNOWN"
        },
        fallbackError: {
          message: fallbackError.message,
          type: fallbackError.errorType || "UNKNOWN"
        },
        userPhoneNumber,
        originalErrorType: errorContext.errorType,
        originalError: errorContext.errorMessage,
        attemptedMessage: message,
        severity: "CRITICAL",
        requiresManualIntervention: true
      });
      
      // In a production system, this would trigger alerts for manual intervention
      // since the user cannot be notified of the error
    }
  }
}



/**
 * Process Cloud API image messages
 */
async function processCloudApiImage(
  mediaData,
  userPhoneNumber,
  userIdString,
  userObjectId,
  generateId,
  twiml
) {
  let tempMediaUrl = null;
  
  try {
    structuredLogger.info("Starting Cloud API image processing", {
      userPhoneNumber,
      userIdString,
      mediaId: mediaData.id,
      mimeType: mediaData.mimeType
    });

    // Create a temporary file or upload to cloud storage
    tempMediaUrl = await createTempMediaUrl(mediaData);
    
    structuredLogger.info("Temporary media URL created", {
      userPhoneNumber,
      mediaId: mediaData.id,
      tempUrl: tempMediaUrl ? "created" : "failed"
    });

    // Use existing AI service for document interpretation
    const result = await interpretDocumentWithAI(tempMediaUrl);

    switch (result.documentType) {
      case "store_receipt": {
        const { totalAmount, storeName, purchaseDate, category } = result.data;
        let transactionDate = new Date(`${purchaseDate}T12:00:00`);
        if (isNaN(transactionDate.getTime())) {
          transactionDate = new Date();
        }

        const description = `${storeName} - ${transactionDate.toLocaleDateString(
          "pt-BR"
        )}`;
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
          date: transactionDate,
          messageId: generateId(),
          paymentMethodId: defaultPaymentMethod._id.toString(),
          status: "completed",
        });
        await newExpense.save();
        await UserStats.findOneAndUpdate(
          { userId: userObjectId },
          { $inc: { totalSpent: totalAmount } }
        );

        // Send success message via Cloud API with logging
        const successMessage = `✅ Despesa de *${storeName}* no valor de *R$ ${totalAmount.toFixed(
          2
        )}* registrada com sucesso!`;
        
        await sendCloudApiMessage(userPhoneNumber, successMessage);
        
        structuredLogger.info("Store receipt processed successfully", {
          userPhoneNumber,
          storeName,
          totalAmount,
          category: category.toLowerCase(),
          transactionId: newExpense._id.toString(),
          messageLength: successMessage.length
        });
        break;
      }

      case "utility_bill": {
        const { totalAmount, provider, dueDate } = result.data;
        const [year, month, day] = dueDate.split("-");
        const formattedDate = `${day}/${month}/${year}`;

        let confirmationMessage = `🧾 Conta identificada:\n\n`;
        confirmationMessage += `*Empresa:* ${provider}\n*Valor:* R$ ${totalAmount.toFixed(
          2
        )}\n*Vencimento:* ${formattedDate}\n\n`;
        confirmationMessage +=
          "Você já pagou esta conta?\n\nResponda com `sim` ou `não`.";

        conversationState[userIdString] = {
          awaiting: "payment_status_confirmation",
          payload: result.data,
        };
        
        await sendCloudApiMessage(userPhoneNumber, confirmationMessage);
        
        structuredLogger.info("Utility bill identified, awaiting payment confirmation", {
          userPhoneNumber,
          provider,
          totalAmount,
          dueDate,
          formattedDate,
          conversationState: "payment_status_confirmation"
        });
        break;
      }

      case "pix_receipt": {
        const { totalAmount, counterpartName } = result.data;
        let pixMessage = `🧾 PIX identificado:\n\n*Valor:* R$ ${totalAmount.toFixed(
          2
        )}\n*Para/De:* ${counterpartName}\n\n`;
        pixMessage +=
          "Este PIX foi um pagamento que você *FEZ* ou um valor que você *RECEBEU*?\n\nResponda `fiz` ou `recebi`.";

        conversationState[userIdString] = {
          awaiting: "pix_type_confirmation",
          payload: result.data,
        };
        
        await sendCloudApiMessage(userPhoneNumber, pixMessage);
        
        structuredLogger.info("PIX receipt identified, awaiting type confirmation", {
          userPhoneNumber,
          totalAmount,
          counterpartName,
          conversationState: "pix_type_confirmation"
        });
        break;
      }

      default:
        // Send error message via Cloud API
        const unrecognizedMessage = "🫤 Desculpe, não consegui identificar um documento financeiro válido nesta imagem. Tente uma foto mais nítida.";
        
        await sendCloudApiMessage(userPhoneNumber, unrecognizedMessage);
        
        structuredLogger.warn("Unrecognized document type in image", {
          userPhoneNumber,
          mediaId: mediaData.id,
          documentType: result.documentType || "unknown",
          aiResult: result,
          messageLength: unrecognizedMessage.length
        });
        break;
    }

    // Clean up temporary file
    if (tempMediaUrl) {
      await cleanupTempMediaUrl(tempMediaUrl);
      structuredLogger.info("Temporary media URL cleaned up", {
        userPhoneNumber,
        mediaId: mediaData.id
      });
    }
  } catch (error) {
    // Enhanced error handling for different failure scenarios
    await handleImageProcessingError(error, userPhoneNumber, mediaData, tempMediaUrl);
  }
}

/**
 * Handle document processing errors
 */
async function handleDocumentProcessingError(error, userPhoneNumber, mediaData) {
  const errorContext = {
    userPhoneNumber,
    mediaId: mediaData?.id,
    mimeType: mediaData?.mimeType,
    errorMessage: error.message,
    errorType: "DOCUMENT_PROCESSING_ERROR"
  };

  let userMessage = "❌ Erro ao processar documento. Tente novamente.";

  // Classify document-specific errors
  if (error.message?.includes('PDF') || error.message?.includes('document format')) {
    userMessage = "📄 Formato de documento não suportado. Envie um PDF ou imagem do documento.";
    errorContext.errorType = "UNSUPPORTED_DOCUMENT_FORMAT";
  } else if (error.message?.includes('text extraction') || error.message?.includes('OCR')) {
    userMessage = "🔍 Não foi possível extrair texto do documento. Tente uma imagem mais nítida.";
    errorContext.errorType = "TEXT_EXTRACTION_ERROR";
  }

  structuredLogger.error("Document processing error", errorContext);
  await sendErrorMessageWithFallback(userPhoneNumber, userMessage, errorContext);
}

/**
 * Handle audio processing errors
 */
async function handleAudioProcessingError(error, userPhoneNumber, mediaData) {
  const errorContext = {
    userPhoneNumber,
    mediaId: mediaData?.id,
    mimeType: mediaData?.mimeType,
    errorMessage: error.message,
    errorType: "AUDIO_PROCESSING_ERROR"
  };

  let userMessage = "❌ Desculpe, não consegui processar seu áudio. Tente enviar uma mensagem de texto.";

  // Classify audio-specific errors
  if (error.message?.includes('transcription') || error.message?.includes('Whisper')) {
    userMessage = "🎤 Não foi possível transcrever o áudio. Tente falar mais claramente ou enviar uma mensagem de texto.";
    errorContext.errorType = "TRANSCRIPTION_ERROR";
  } else if (error.message?.includes('audio format') || error.message?.includes('codec')) {
    userMessage = "🎵 Formato de áudio não suportado. Envie um áudio em formato compatível.";
    errorContext.errorType = "UNSUPPORTED_AUDIO_FORMAT";
  } else if (error.message?.includes('duration') || error.message?.includes('too long')) {
    userMessage = "⏱️ Áudio muito longo. Envie um áudio de até 2 minutos ou uma mensagem de texto.";
    errorContext.errorType = "AUDIO_TOO_LONG";
  }

  structuredLogger.error("Audio processing error", errorContext);
  await sendErrorMessageWithFallback(userPhoneNumber, userMessage, errorContext);
}

/**
 * Process Cloud API document messages
 */
async function processCloudApiDocument(
  mediaData,
  userPhoneNumber,
  userIdString,
  userObjectId,
  generateId,
  twiml
) {
  try {
    // Handle document processing similar to images
    const tempMediaUrl = await createTempMediaUrl(mediaData);
    const result = await interpretDocumentWithAI(tempMediaUrl);

    // Process similar to image processing
    await processCloudApiImage(
      mediaData,
      userPhoneNumber,
      userIdString,
      userObjectId,
      generateId,
      twiml
    );

    await cleanupTempMediaUrl(tempMediaUrl);
  } catch (error) {
    await handleDocumentProcessingError(error, userPhoneNumber, mediaData);
  }
}

/**
 * Process Cloud API audio messages
 */
async function processCloudApiAudio(
  mediaData,
  userPhoneNumber,
  userIdString,
  userObjectId,
  generateId,
  twiml
) {
  try {
    // Create temporary URL for audio processing
    const tempMediaUrl = await createTempMediaUrl(mediaData);

    // Use existing audio transcription service
    const transcription = await transcribeAudioWithWhisper(tempMediaUrl);

    structuredLogger.info("Audio transcribed successfully", {
      mediaId: mediaData.id,
      transcriptionLength: transcription.length,
    });

    // Process the transcribed text as a regular message
    // Create a mock request for text processing
    const mockReq = {
      body: {
        From: userPhoneNumber,
        Body: transcription,
        MediaUrl0: null,
        MediaContentType0: null,
      },
    };

    await processMessageWithExistingLogic(
      mockReq,
      false,
      transcription,
      userPhoneNumber
    );

    await cleanupTempMediaUrl(tempMediaUrl);
  } catch (error) {
    await handleAudioProcessingError(error, userPhoneNumber, mediaData);
  }
}

/**
 * Create temporary URL for media processing
 * In a production environment, this should upload to cloud storage
 */
async function createTempMediaUrl(mediaData) {
  try {
    // For now, we'll create a data URL for small files
    // In production, upload to S3, Cloudinary, or similar service

    if (mediaData.fileSize > 5 * 1024 * 1024) {
      // 5MB limit for data URLs
      throw new Error("File too large for temporary processing");
    }

    const base64Content = mediaData.content.toString("base64");
    const dataUrl = `data:${mediaData.mimeType};base64,${base64Content}`;

    console.log('Creating data URL - MIME type:', mediaData.mimeType);
    console.log('Content type:', typeof mediaData.content);
    console.log('Content is Buffer:', Buffer.isBuffer(mediaData.content));
    console.log('Content length:', mediaData.content.length);
    console.log('Base64 length:', base64Content.length);
    console.log('Data URL preview:', dataUrl.substring(0, 100) + '...');
    
    // Validate the base64 content
    try {
      const testBuffer = Buffer.from(base64Content, 'base64');
      console.log('Base64 validation successful, decoded length:', testBuffer.length);
    } catch (e) {
      console.log('Base64 validation failed:', e.message);
    }

    structuredLogger.info("Created temporary media URL", {
      mediaId: mediaData.id,
      mimeType: mediaData.mimeType,
      fileSize: mediaData.fileSize,
    });

    return dataUrl;
  } catch (error) {
    structuredLogger.error("Error creating temporary media URL", {
      error: error.message,
      mediaId: mediaData.id,
    });
    throw error;
  }
}

/**
 * Clean up temporary media URL
 */
async function cleanupTempMediaUrl(tempUrl) {
  try {
    // For data URLs, no cleanup needed
    // For cloud storage, delete the temporary file
    structuredLogger.debug("Cleaned up temporary media URL", {
      tempUrl: tempUrl.substring(0, 50) + "...",
    });
  } catch (error) {
    structuredLogger.warn("Error cleaning up temporary media URL", {
      error: error.message,
    });
  }
}

export default router;
