import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
import Reminder from "../models/Reminder.js";
import { TIMEZONE, formatInBrazilWithTime } from "../utils/dateUtils.js";
import mongoose from "mongoose";

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

export async function calculateTotalIncome(
  userId,
  month = null,
  categoryName = null
) {
  try {
    const pipeline = [];
    let initialMatch = {
      userId: userId,
      type: "income",
      status: { $in: ["completed", "pending"] },
    };

    if (month) {
      initialMatch.$expr = {
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
    pipeline.push({ $match: initialMatch });

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
  month = null
) {
  try {
    const matchQuery = {
      userId: userId,
      type: "expense",
      status: { $in: ["completed", "pending"] },
    };

    if (categoryName) {
      const category = await Category.findOne({
        userId: userId,
        name: { $regex: new RegExp(`^${categoryName.trim()}$`, "i") },
      });
      if (!category) return 0;
      matchQuery.categoryId = category._id.toString();
    }

    if (month) {
      const year = parseInt(month.split("-")[0]);
      const monthNumber = parseInt(month.split("-")[1]);
      const startDate = new Date(Date.UTC(year, monthNumber - 1, 1, 0, 0, 0));
      const endDate = new Date(Date.UTC(year, monthNumber, 1, 0, 0, 0));
      endDate.setMilliseconds(endDate.getMilliseconds() - 1);

      matchQuery.date = { $gte: startDate, $lte: endDate };
    }
    const result = await Transaction.aggregate([
      { $match: matchQuery },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    return result.length > 0 ? result[0].total : 0;
  } catch (err) {
    console.error("Erro ao buscar total de gastos:", err);
    return 0;
  }
}

export async function getExpensesReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));

  startDate.setHours(0, 0, 0, 0);

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
  categoryName
) {
  try {
    const matchQuery = {
      userId: userId,
      type: "expense",
      status: { $in: ["completed", "pending"] },
    };

    if (month) {
      const year = parseInt(month.split("-")[0]);
      const monthNumber = parseInt(month.split("-")[1]);
      const startDate = new Date(Date.UTC(year, monthNumber - 1, 1));
      const endDate = new Date(Date.UTC(year, monthNumber, 1));
      endDate.setMilliseconds(endDate.getMilliseconds() - 1);
      matchQuery.date = { $gte: startDate, $lte: endDate };
    }

    if (categoryName) {
      const category = await Category.findOne({
        userId: userId,
        name: { $regex: new RegExp(`^${categoryName.trim()}$`, "i") },
      });
      if (!category) {
        return { messages: ["Nenhum gasto encontrado para esta categoria."], transactionIds: [] };
      }
      matchQuery.categoryId = category._id.toString();
    }
    
    const expenses = await Transaction.aggregate([
      { $match: matchQuery },
      {
        $addFields: {
          convertedCategoryId: { $toObjectId: "$categoryId" }
        }
      },
      {
        $lookup: {
          from: "categories", 
          localField: "convertedCategoryId",
          foreignField: "_id",
          as: "categoryDetails" 
        }
      },
      {
        $unwind: {
          path: "$categoryDetails",
          preserveNullAndEmptyArrays: true 
        }
      },
      { $sort: { 'categoryDetails.name': 1, date: 1 } }
    ]);


    if (expenses.length === 0) {
      return { messages: ["Nenhum gasto encontrado para este período."], transactionIds: [] };
    }

    const bodyLines = [];
    const transactionIds = [];
    let itemCounter = 1;
    let currentCategoryName = '';

    for (const expense of expenses) {
      const categoryDisplay = expense.categoryDetails && expense.categoryDetails.name
        ? expense.categoryDetails.name.charAt(0).toUpperCase() + expense.categoryDetails.name.slice(1)
        : 'Outro';

      if (!categoryName && categoryDisplay !== currentCategoryName) {
        const prefix = currentCategoryName === '' ? '' : '\n'; 
        
        bodyLines.push(`${prefix}📁 ${categoryDisplay}`);
        currentCategoryName = categoryDisplay;
      }

      const amount = expense.amount != null ? expense.amount.toFixed(2) : "0.00";
      bodyLines.push(`${itemCounter}. ${expense.description}: R$ ${amount}`);
      transactionIds.push(expense._id.toString());
      itemCounter++;
    }

    const header = categoryName
      ? `🧾 Detalhes dos gastos em _*${categoryName}*_ no mês de _*${monthName}*:`
      : `🧾 Detalhes de todos os gastos no mês de _*${monthName}*_:`;

    const linesToChunk = [header, ...bodyLines];
    const messageChunks = chunkLinesIntoMessages(linesToChunk);

    const footer = `\n\nPara apagar um item, envie "apagar item" e o número (ex: *apagar item 3*).`;
    if (messageChunks.length > 0) {
      messageChunks[messageChunks.length - 1] += footer;
    }

    return { messages: messageChunks, transactionIds: transactionIds };

  } catch (error) {
    console.error("Erro ao buscar despesas por categoria:", error);
    return { messages: ["Ocorreu um erro ao buscar os gastos. Tente novamente."], transactionIds: [] };
  }
}

export async function getIncomeDetails(userId, month, monthName, categoryName) {
  try {
    let matchStage = {
      userId: userId,
      type: "income",
      status: { $in: ["completed", "pending"] },
    };

    if (month) {
      matchStage.$expr = {
        $eq: [
          { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } },
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
          as: "categoryDetails"
        }
      },
      {
        $unwind: {
          path: "$categoryDetails",
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    if (categoryName) {
      pipeline.push({
        $match: {
          "categoryDetails.name": { $regex: new RegExp(`^${categoryName.trim()}$`, "i") },
        },
      });
    }

    pipeline.push({ $sort: { 'categoryDetails.name': 1, date: 1 } });

    const incomes = await Transaction.aggregate(pipeline);

    if (incomes.length === 0) {
      return { messages: ["Nenhuma receita encontrada para este período."], transactionIds: [] };
    }

    const bodyLines = [];
    const transactionIds = [];
    let itemCounter = 1;
    let currentCategoryName = '';

    for (const income of incomes) {
      const categoryDisplay = income.categoryDetails && income.categoryDetails.name
        ? income.categoryDetails.name.charAt(0).toUpperCase() + income.categoryDetails.name.slice(1)
        : 'Outro';

      if (!categoryName && categoryDisplay !== currentCategoryName) {
        const prefix = currentCategoryName === '' ? '' : '\n';
        
        bodyLines.push(`${prefix}📁 ${categoryDisplay}`);
        currentCategoryName = categoryDisplay;
      }

      const amount = income.amount != null ? income.amount.toFixed(2) : "0.00";
      bodyLines.push(`${itemCounter}. ${income.description}: R$ ${amount}`);
      transactionIds.push(income._id.toString());
      itemCounter++;
    }
    
    const header = categoryName
      ? `🧾 Detalhes das receitas de _*${categoryName}*_ no mês de _*${monthName}*:`
      : `🧾 Detalhes de todas as receitas no mês de _*${monthName}*_:`;

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
      messages: ["Ocorreu um erro ao buscar os detalhes das receitas. Tente novamente."],
      transactionIds: []
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
    userId: new mongoose.Types.ObjectId(userId),
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