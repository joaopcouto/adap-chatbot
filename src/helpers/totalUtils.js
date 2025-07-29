import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
import PaymentMethods from "../models/paymentmethods.js";
import Reminder from "../models/Reminder.js";
import {
  TIMEZONE,
  formatInBrazil,
  formatInBrazilWithTime,
} from "../utils/dateUtils.js";
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
      userId: new mongoose.Types.ObjectId(userId),
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
    const pipeline = [];
    const initialMatch = {
      userId: new mongoose.Types.ObjectId(userId),
      type: "expense",
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
    console.error("Erro ao buscar total de gastos:", err);
    return 0;
  }
}

export async function getExpensesReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days + 1));

  return Transaction.aggregate([
    {
      $match: { userId, type: "expense", date: { $gte: startDate } },
      status: { $in: ["completed", "pending"] },
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
    { $limit: days },
  ]);
}

export async function getCategoryReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return Transaction.aggregate([
    {
      $match: { userId, type: "expense", date: { $gte: startDate } },
      status: { $in: ["completed", "pending"] },
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
    let matchStage = {
      userId: new mongoose.Types.ObjectId(userId),
      type: "expense",
      status: { $in: ["completed", "pending"] },
    };

    if (month) {
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
    ];

    if (categoryName) {
      pipeline.push({
        $match: {
          "category.name": {
            $regex: new RegExp(`^${categoryName.trim()}$`, "i"),
          },
        },
      });
    }

    pipeline.push({ $sort: { "category.name": 1, date: 1 } });

    const expenses = await Transaction.aggregate(pipeline);

    if (expenses.length === 0) {
      return ["Nenhum gasto encontrado para este período."];
    }

    const reportLines = [];

    if (!categoryName) {
      reportLines.push(
        `🧾 Detalhes de todos os gastos no mês de _*${monthName}*_:`
      );

      const expensesByCategory = {};
      expenses.forEach((expense) => {
        const cat = expense.category.name || "Sem Categoria";
        if (!expensesByCategory[cat]) {
          expensesByCategory[cat] = [];
        }
        expensesByCategory[cat].push(
          ` 💸 ${expense.description}: R$ ${expense.amount.toFixed(2)} (#${
            expense.messageId
          })`
        );
      });

      let i = 0;
      for (const cat in expensesByCategory) {
        const catNameFormatted = cat.charAt(0).toUpperCase() + cat.slice(1);
        const prefix = i === 0 ? "" : "\n";
        reportLines.push(`${prefix}📁 ${catNameFormatted}`);
        reportLines.push(...expensesByCategory[cat]);
        i++;
      }
    } else {
      reportLines.push(
        `🧾 Detalhes dos gastos em _*${categoryName}*_ no mês de _*${monthName}*_:`
      );
      const expenseItems = expenses.map(
        (expense) =>
          ` 💸 ${expense.description}: R$ ${expense.amount.toFixed(2)} (#${
            expense.messageId
          })`
      );
      reportLines.push(...expenseItems);
    }

    return chunkLinesIntoMessages(reportLines);
  } catch (error) {
    console.error("Erro ao buscar despesas por categoria:", error);
    return ["Ocorreu um erro ao buscar os gastos. Tente novamente."];
  }
}

export async function getIncomeDetails(userId, month, monthName, categoryName) {
  try {
    let matchStage = {
      userId: new mongoose.Types.ObjectId(userId),
      type: "income",
    };
    if (month) {
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
    ];

    if (categoryName) {
      pipeline.push({
        $match: {
          "category.name": {
            $regex: new RegExp(`^${categoryName.trim()}$`, "i"),
          },
        },
      });
    }

    pipeline.push({ $sort: { date: 1 } });

    const incomes = await Transaction.aggregate(pipeline);

    if (incomes.length === 0) {
      return ["Nenhuma receita encontrada para este período."];
    }

    const reportLines = [];

    const header = categoryName
      ? `🧾 Detalhes das receitas de _*${categoryName}*_ no mês de _*${monthName}*_:`
      : `🧾 Detalhes de todas as receitas no mês de _*${monthName}*_:`;

    reportLines.push(header);

    const incomeItems = incomes.map((income) => {
      const catName =
        income.category.name.charAt(0).toUpperCase() +
        income.category.name.slice(1);
      return ` 💰 ${
        income.description
      } (em _${catName}_): R$ ${income.amount.toFixed(2)} (#${
        income.messageId
      })`;
    });

    reportLines.push(...incomeItems);

    return chunkLinesIntoMessages(reportLines);
  } catch (error) {
    console.error("Erro ao buscar detalhes das receitas:", error);
    return [
      "Ocorreu um erro ao buscar os detalhes das receitas. Tente novamente.",
    ];
  }
}

export async function getOrCreateCategory(userId, categoryName) {
  const standardizedName = categoryName.trim().toLowerCase();
  let category = await Category.findOne({ userId, name: standardizedName });
  if (!category) {
    category = new Category({
      userId,
      name: standardizedName,
      color: "#3498db",
    });
    await category.save();
  }
  return category;
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
          userId: new mongoose.Types.ObjectId(userId),
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
