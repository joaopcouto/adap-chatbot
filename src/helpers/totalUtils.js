import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
import Reminder from "../models/Reminder.js";
import UserStats from "../models/UserStats.js"; 
import {
  TIMEZONE,
  formatInBrazilWithTime,
  formatInBrazil,
} from "../utils/dateUtils.js";
import { toZonedTime } from "date-fns-tz";
import InventoryTemplate from "../models/InventoryTemplate.js";
import Product from "../models/Product.js";

const MESSAGE_LIMIT = 1550;

function chunkLinesIntoMessages(lines) {
  if (!lines || lines.length === 0) {
    return [];
  }

  const chunks = [];
  const header = lines.shift();
  let currentMessageBody = "";

  for (const line of lines) {
    if (currentMessageBody.length + line.length + 1 > MESSAGE_LIMIT - 10) {
      chunks.push(currentMessageBody);
      currentMessageBody = line;
    } else {
      if (currentMessageBody === "") {
        currentMessageBody = line;
      } else {
        currentMessageBody += "\n" + line;
      }
    }
  }
  if (currentMessageBody.length > 0) {
    chunks.push(currentMessageBody);
  }

  const finalMessages = [];
  finalMessages.push(header);
  for (const chunk of chunks) {
    finalMessages.push("```\n" + chunk + "\n```");
  }

  return finalMessages;
}

export async function getMonthlySummary(
  userId,
  month = null,
  startDate = null,
  endDate = null
) {
  try {
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;
    let effectiveMonth = month;

    if (!effectiveStartDate && !effectiveEndDate && !effectiveMonth) {
      const now = toZonedTime(new Date(), TIMEZONE);
      effectiveMonth = `${now.getFullYear()}-${String(
        now.getMonth() + 1
      ).padStart(2, "0")}`;
    }

    const totalIncome = await calculateTotalIncome(
      userId,
      effectiveMonth,
      null,
      effectiveStartDate,
      effectiveEndDate
    );
    const totalExpenses = await calculateTotalExpenses(
      userId,
      null,
      effectiveMonth,
      effectiveStartDate,
      effectiveEndDate
    );
    const balance = totalIncome - totalExpenses;
    return { income: totalIncome, expenses: totalExpenses, balance: balance };
  } catch (err) {
    console.error("Erro ao buscar o resumo mensal:", err);
    return { income: 0, expenses: 0, balance: 0 };
  }
}

export async function calculateTotalIncome(
  userId,
  month = null,
  categoryName = null,
  startDate = null,
  endDate = null
) {
  try {
    console.log("calculateTotalIncome called with:", { userId, month, categoryName });
    
    const pipeline = [];
    const matchQuery = {
      userId: userId,
      type: "income",
      status: { $in: ["completed", "pending"] },
    };

    if (startDate && endDate) {
        matchQuery.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
        pipeline.push({ $match: matchQuery });
    } else if (month) {
        pipeline.push({ $match: matchQuery });
        pipeline.push({ $match: { $expr: { $eq: [ { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } }, month ] } } });
        console.log("calculateTotalIncome - Month filter applied:", { month, matchQuery });
    } else {
        pipeline.push({ $match: matchQuery });
        console.log("calculateTotalIncome - No month filter, querying all time");
    }

    if (categoryName) {
      pipeline.push({
        $lookup: {
          from: "categories",
          let: { category_id: "$categoryId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$category_id"] },
                name: { $regex: new RegExp(`^${categoryName.trim()}$`, "i") },
              },
            },
          ],
          as: "categoryDoc",
        },
      });
      pipeline.push({ $match: { categoryDoc: { $ne: [] } } });
    }

    pipeline.push({ $group: { _id: null, total: { $sum: "$amount" } } });
    const result = await Transaction.aggregate(pipeline);
    return result.length > 0 ? result[0].total : 0;
  } catch (err) {
    console.error("Erro ao buscar total de receita:", err);
    return 0;
  }
}

export async function calculateTotalExpenses(
  userId,
  categoryName = null,
  month = null,
  startDate = null,
  endDate = null
) {
  try {
    const pipeline = [];
    const matchQuery = {
      userId: userId,
      type: "expense",
      status: { $in: ["completed", "pending"] },
    };

    if (startDate && endDate) {
      matchQuery.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
      pipeline.push({ $match: matchQuery });
    } else if (month) {
      pipeline.push({ $match: matchQuery });
      pipeline.push({ $match: { $expr: { $eq: [ { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } }, month ] } } });
    } else {
       pipeline.push({ $match: matchQuery });
    }

    if (categoryName) {
      const category = await Category.findOne({
        userId,
        name: { $regex: new RegExp(`^${categoryName.trim()}$`, "i") },
      });
      if (category) {
        pipeline.push({ $match: { categoryId: category._id.toString() } });
      } else {
        return 0;
      }
    }

    if (month) {
      pipeline.push({
        $match: {
          $expr: {
            $eq: [
              {
                $dateToString: {
                  format: "%Y-%m",
                  date: "$date",
                  timezone: TIMEZONE,
                },
              },
              month,
            ],
          },
        },
      });
    }

    pipeline.push({ $group: { _id: null, total: { $sum: "$amount" } } });
    const result = await Transaction.aggregate(pipeline);
    return result.length > 0 ? result[0].total : 0;
  } catch (err) {
    console.error("Erro ao buscar total de gastos:", err);
    return 0;
  }
}

export async function getExpensesReport(userId, days) {
  const nowInBrazil = toZonedTime(new Date(), TIMEZONE);
  nowInBrazil.setHours(0, 0, 0, 0);

  const startDate = new Date(nowInBrazil);
  startDate.setDate(startDate.getDate() - (days - 1));

  return Transaction.aggregate([
    {
      $match: {
        userId,
        type: "expense",
        date: { $gte: startDate },
        status: { $in: ["completed", "pending"] },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$date",
            timezone: TIMEZONE,
          },
        },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

export async function getCategoryReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return Transaction.aggregate([
    {
      $match: {
        userId,
        type: "expense",
        date: { $gte: startDate },
        status: { $in: ["completed", "pending"] },
      },
    },
    {
      $lookup: {
        from: "categories",
        let: { category_id_str: "$categoryId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", { $toObjectId: "$$category_id_str" }] },
            },
          },
        ],
        as: "category",
      },
    },
    { $unwind: "$category" },
    {
      $group: {
        _id: "$category.name",
        total: { $sum: "$amount" },
      },
    },
  ]);
}

export async function getExpenseDetails(
  userId,
  month,
  monthName,
  categoryName,
  startDate = null,
  endDate = null,
  periodName = null,
  addFooter = true
) {
  try {
    const matchQuery = {
      userId: userId,
      type: "expense",
      status: { $in: ["completed", "pending"] },
    };

    if (startDate && endDate) {
      matchQuery.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    } else if (month) {
      const year = parseInt(month.split("-")[0]);
      const monthNumber = parseInt(month.split("-")[1]);
      const startOfMonth = new Date(Date.UTC(year, monthNumber - 1, 1));
      const endOfMonth = new Date(
        Date.UTC(year, monthNumber, 0, 23, 59, 59, 999)
      );
      matchQuery.date = { $gte: startOfMonth, $lte: endOfMonth };
    }

    if (categoryName) {
      const category = await Category.findOne({
        userId: userId,
        name: { $regex: new RegExp(`^${categoryName.trim()}$`, "i") },
      });
      if (!category) {
        return {
          messages: ["Nenhum gasto encontrado para esta categoria."],
          transactionIds: [],
        };
      }
      matchQuery.categoryId = category._id.toString();
    }

    const expenses = await Transaction.aggregate([
      { $match: matchQuery },
      {
        $addFields: {
          convertedCategoryId: { $toObjectId: "$categoryId" },
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "convertedCategoryId",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $unwind: {
          path: "$categoryDetails",
          preserveNullAndEmptyArrays: true,
        },
      },
      { $sort: { "categoryDetails.name": 1, date: 1 } },
    ]);

    if (expenses.length === 0) {
      return {
        messages: ["Nenhum gasto encontrado para este período."],
        transactionIds: [],
      };
    }

    const bodyLines = [];
    const transactionIds = [];
    let itemCounter = 1;
    let currentCategoryName = "";

    for (const expense of expenses) {
      const categoryDisplay =
        expense.categoryDetails && expense.categoryDetails.name
          ? expense.categoryDetails.name.charAt(0).toUpperCase() +
            expense.categoryDetails.name.slice(1)
          : "Outro";

      if (!categoryName && categoryDisplay !== currentCategoryName) {
        const prefix = currentCategoryName === "" ? "" : "\n";

        bodyLines.push(`${prefix}📁 ${categoryDisplay}`);
        currentCategoryName = categoryDisplay;
      }

      const amount =
        expense.amount != null ? expense.amount.toFixed(2) : "0.00";
      bodyLines.push(`${itemCounter}. ${expense.description}: R$ ${amount}`);
      transactionIds.push(expense._id.toString());
      itemCounter++;
    }

    let header;
    const periodNameToUse =
      periodName || (monthName ? `no mês de ${monthName}` : "");
    if (categoryName) {
      header = `🧾 Detalhes dos gastos em _*${categoryName}*_ ${periodNameToUse}:`;
    } else {
      header = `🧾 Detalhes de todos os gastos ${periodNameToUse}:`;
    }

    const linesToChunk = [header, ...bodyLines];
    const messageChunks = chunkLinesIntoMessages(linesToChunk);

    if (addFooter) {
      const footer = `\n\nPara apagar um item, envie "apagar item" e o número (ex: *apagar item 3*).`;
      if (messageChunks.length > 0) {
        messageChunks[messageChunks.length - 1] += footer;
      }
    }

    return { messages: messageChunks, transactionIds: transactionIds };
  } catch (error) {
    console.error("Erro ao buscar despesas por categoria:", error);
    return {
      messages: ["Ocorreu um erro ao buscar os gastos. Tente novamente."],
      transactionIds: [],
    };
  }
}

export async function getIncomeDetails(
  userId,
  month,
  monthName,
  categoryName,
  startDate = null,
  endDate = null,
  periodName = null
) {
  try {
    let matchStage = {
      userId: userId,
      type: "income",
      status: { $in: ["completed", "pending"] },
    };

    if (startDate && endDate) {
      matchStage.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    } else if (month) {
      matchStage.$expr = {
        $eq: [
          {
            $dateToString: {
              format: "%Y-%m",
              date: "$date",
              timezone: TIMEZONE,
            },
          },
          month,
        ],
      };
    }

    const pipeline = [
      { $match: matchStage },
      { $addFields: { convertedCategoryId: { $toObjectId: "$categoryId" } } },
      {
        $lookup: {
          from: "categories",
          localField: "convertedCategoryId",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $unwind: {
          path: "$categoryDetails",
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    if (categoryName) {
      pipeline.push({
        $match: {
          "categoryDetails.name": {
            $regex: new RegExp(`^${categoryName.trim()}$`, "i"),
          },
        },
      });
    }

    pipeline.push({ $sort: { "categoryDetails.name": 1, date: 1 } });

    const incomes = await Transaction.aggregate(pipeline);

    if (incomes.length === 0) {
      return {
        messages: ["Nenhuma receita encontrada para este período."],
        transactionIds: [],
      };
    }

    const bodyLines = [];
    const transactionIds = [];
    let itemCounter = 1;
    let currentCategoryName = "";

    for (const income of incomes) {
      const categoryDisplay =
        income.categoryDetails && income.categoryDetails.name
          ? income.categoryDetails.name.charAt(0).toUpperCase() +
            income.categoryDetails.name.slice(1)
          : "Outro";

      if (!categoryName && categoryDisplay !== currentCategoryName) {
        const prefix = currentCategoryName === "" ? "" : "\n";

        bodyLines.push(`${prefix}📁 ${categoryDisplay}`);
        currentCategoryName = categoryDisplay;
      }

      const amount = income.amount != null ? income.amount.toFixed(2) : "0.00";
      bodyLines.push(`${itemCounter}. ${income.description}: R$ ${amount}`);
      transactionIds.push(income._id.toString());
      itemCounter++;
    }

    let header;
    const periodNameToUse =
      periodName || (monthName ? `no mês de ${monthName}` : "");
    if (categoryName) {
      header = `🧾 Detalhes das receitas em _*${categoryName}*_ ${periodNameToUse}:`;
    } else {
      header = `🧾 Detalhes de todas as receitas ${periodNameToUse}:`;
    }

    const linesToChunk = [header, ...bodyLines];
    const messageChunks = chunkLinesIntoMessages(linesToChunk);

    const footer = `\n\nPara apagar um item, envie "apagar item" e o número (ex: *apagar item 3*).`;
    if (messageChunks.length > 0) {
      messageChunks[messageChunks.length - 1] += footer;
    }

    return { messages: messageChunks, transactionIds: transactionIds };
  } catch (error) {
    console.error("Erro ao buscar detalhes das receitas:", error);
    return {
      messages: [
        "Ocorreu um erro ao buscar os detalhes das receitas. Tente novamente.",
      ],
      transactionIds: [],
    };
  }
}

export async function getOrCreateCategory(userId, categoryName) {
  const standardizedName = categoryName.trim().toLowerCase();
  let category = await Category.findOne({
    userId: userId,
    name: standardizedName,
  });
  if (!category) {
    category = new Category({
      userId: userId,
      name: standardizedName,
      color: "#3498db",
    });
    await category.save();
  }
  return category;
}

export async function getIncomeByCategoryReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return Transaction.aggregate([
    {
      $match: {
        userId,
        type: "income",
        date: { $gte: startDate },
        status: { $in: ["completed", "pending"] },
      },
    },
    {
      $lookup: {
        from: "categories",
        let: { category_id_str: "$categoryId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", { $toObjectId: "$$category_id_str" }] },
            },
          },
        ],
        as: "category",
      },
    },
    { $unwind: "$category" },
    {
      $group: {
        _id: "$category.name",
        total: { $sum: "$amount" },
      },
    },
  ]);
}

export async function getTotalReminders(userId) {
  const allFutureRemindersArray = await Reminder.find({
    userId: userId,
    date: { $gte: new Date() },
  }).sort({ date: "asc" });

  if (allFutureRemindersArray.length === 0) {
    return "Você não tem nenhum lembrete futuro. ✨\n\nPara adicionar um, é só dizer o que e quando! Ex: 'Lembrar de comprar pão amanhã às 8h'.";
  }

  const reminderBlocks = allFutureRemindersArray
    .map((r) => {
      const formattedDateTime = formatInBrazilWithTime(r.date);
      const messageCode = r.messageId ? `\`#${r.messageId}\`` : "";
      return [
        `📝 *${r.description.toUpperCase()}*`,
        `⏰ *Quando:* ${formattedDateTime}`,
        `🆔 *ID para apagar:* ${messageCode}`,
      ].join("\n");
    })
    .join("\n\n- - - - - - - - - - - - - -\n\n");

  const header = "🔔 *Seus próximos lembretes:*\n\n";
  const footer = `\n\nPara remover um item, envie: *apagar lembrete #ID*`;

  return header + reminderBlocks + footer;
}

export async function getActiveInstallments(userId) {
  try {
    const activeInstallments = await Transaction.aggregate([
      {
        $match: {
          userId: userId,
          installmentsGroupId: { $ne: null },
          status: "pending",
        },
      },
      {
        $group: {
          _id: "$installmentsGroupId",
        },
      },
      {
        $lookup: {
          from: "transactions",
          let: { groupId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$installmentsGroupId", "$$groupId"] },
              },
            },
            {
              $sort: { installmentsCurrent: 1 },
            },
          ],
          as: "installments",
        },
      },
      {
        $unwind: "$installments",
      },
      {
        $replaceRoot: { newRoot: "$installments" },
      },
      {
        $group: {
          _id: "$installmentsGroupId",
          description: { $first: "$description" },
          totalInstallments: { $first: "$installmentsCount" },
          installmentAmount: { $first: "$amount" },
          pendingCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "pending"] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          groupId: "$_id",
          description: {
            $trim: {
              input: { $arrayElemAt: [{ $split: ["$description", " - "] }, 0] },
            },
          },
          totalInstallments: "$totalInstallments",
          installmentAmount: "$installmentAmount",
          pendingCount: "$pendingCount",
        },
      },
      {
        $sort: { description: 1 },
      },
    ]);

    return activeInstallments;
  } catch (error) {
    console.error("Erro ao buscar parcelamentos ativos:", error);
    return [];
  }
}

export async function getFormattedInventory(userId, templateName) {
  const template = await InventoryTemplate.findOne({
    userId: userId,
    templateName: { $regex: new RegExp(`^${templateName.toLowerCase()}`, "i") },
  });

  if (!template) {
    return {
      messages: [
        `Não encontrei um estoque chamado *${templateName}*. Para ver seus estoques, diga "listar estoques".`,
      ],
    };
  }

  const products = await Product.find({
    userId: userId,
    templateId: template._id,
  }).sort({ "attributes.Nome": 1 });

  if (products.length === 0) {
    return {
      messages: [
        `Você ainda não tem nenhum item no estoque *${template.templateName}*. Para adicionar, diga "adicionar ${template.templateName}".`,
      ],
    };
  }

  const header = `📦 *Estoque de ${
    template.templateName.charAt(0).toUpperCase() +
    template.templateName.slice(1)
  }:*\n\n`;
  let chunks = [];
  let currentChunk = "";

  products.forEach((product, index) => {
    const descriptionParts = [];
    template.fields.forEach((field) => {
      if (product.attributes.has(field)) {
        descriptionParts.push(product.attributes.get(field));
      }
    });
    const description = descriptionParts.join(" ");

    const productLine = `🆔 *#${product.customId}* - ${description}\n   - *Quantidade:* ${product.quantity}\n   - *Alerta em:* ${product.minStockLevel} unidades\n\n`;

    if (
      (index === 0 ? header.length : 0) +
        currentChunk.length +
        productLine.length >
      MESSAGE_LIMIT
    ) {
      chunks.push(currentChunk);
      currentChunk = productLine;
    } else {
      currentChunk += productLine;
    }
  });

  chunks.push(currentChunk);

  const finalMessages = chunks.map((chunk, index) => {
    if (index === 0) {
      return header + chunk;
    }
    return chunk;
  });

  const footer = `\nPara movimentar o estoque, use o ID. Ex: "vendi 2 #${products[0].customId}"`;

  if (
    finalMessages[finalMessages.length - 1].length + footer.length <=
    MESSAGE_LIMIT
  ) {
    finalMessages[finalMessages.length - 1] += footer;
  } else {
    finalMessages.push(footer);
  }

  return { messages: finalMessages };
}

export async function getUserCategories(userId) {
  const categories = await Category.find({ userId: userId }).lean();
  return categories.map(
    (c) => c.name.charAt(0).toUpperCase() + c.name.slice(1)
  );
}

export async function getFormattedCategories(userId) {
  const categories = await Category.find({ userId: userId }).sort({ name: 1 }).lean();

  if (categories.length === 0) {
    return "Você ainda não criou nenhuma categoria personalizada. Basta registrar um gasto com uma nova categoria para criá-la! Ex: `25 café em padaria`";
  }

  let message = "📁 *Suas Categorias e Limites Mensais:*\n\n";
  message += categories.map(c => {
    let line = `• ${c.name.charAt(0).toUpperCase() + c.name.slice(1)}`;
    if (c.monthlyLimit && c.monthlyLimit > 0) {
      line += ` (Limite: R$ ${c.monthlyLimit.toFixed(2)})`;
    }
    return line;
  }).join("\n");
  
  message += `\n\nPara definir um limite, envie: *limite [categoria] para [valor]*`;
  message += `\nPara excluir, envie: *excluir categoria [nome]*`;

  return message;
}

export async function deleteCategoryAndTransactions(userId, categoryName) {
  const standardizedName = categoryName.trim().toLowerCase();
  
  const category = await Category.findOne({
    userId: userId,
    name: standardizedName,
  });

  if (!category) {
    return { success: false, message: `🚫 Categoria "*${categoryName}*" não encontrada.` };
  }

  const categoryId = category._id.toString();

  const transactionsToDelete = await Transaction.find({ userId: userId, categoryId: categoryId });
  let totalSpentReverted = 0;
  let totalIncomeReverted = 0;

  transactionsToDelete.forEach(t => {
    if (t.type === 'expense') {
      totalSpentReverted += t.amount;
    } else if (t.type === 'income') {
      totalIncomeReverted += t.amount;
    }
  });

  const deleteResult = await Transaction.deleteMany({ userId: userId, categoryId: categoryId });

  await Category.findByIdAndDelete(categoryId);

  await UserStats.findOneAndUpdate(
    { userId: category.userId }, 
    { 
      $inc: { 
        totalSpent: -totalSpentReverted,
        totalIncome: -totalIncomeReverted 
      } 
    }
  );

  return { 
    success: true, 
    message: `🗑️ Categoria "*${category.name}*" e *${deleteResult.deletedCount}* transações associadas foram excluídas com sucesso.` 
  };
}

export async function checkCategoryLimit(userId, categoryId, newExpenseAmount) {
  const category = await Category.findById(categoryId).lean();

  if (!category || !category.monthlyLimit || category.monthlyLimit <= 0) {
    return null;
  }

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const newTotal = await calculateTotalExpenses(userId, category.name, currentMonth);
  
  const oldTotal = newTotal - newExpenseAmount;

  if (newTotal >= category.monthlyLimit && oldTotal < category.monthlyLimit) {
    const overage = newTotal - category.monthlyLimit;
    return `⚠️ *Limite de Categoria Atingido!*\n\nVocê ultrapassou seu limite de *R$ ${category.monthlyLimit.toFixed(2)}* para a categoria "*${category.name}*".\n\nCom este novo gasto, você está *R$ ${overage.toFixed(2)}* acima do estimado para o mês.`;
  }

  return null;
}