import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
import Reminder from "../models/Reminder.js";
import { TIMEZONE, formatInBrazil } from "../utils/dateUtils.js";
import mongoose from "mongoose";

const MESSAGE_LIMIT = 1550; // Limite seguro, um pouco abaixo dos 1600 do WhatsApp

/**
 * FUNÇÃO AUXILIAR REVISADA E RENOMEADA
 * Particiona um array de linhas de texto em várias mensagens.
 * @param {string[]} lines - Array de strings, onde cada string é uma linha do relatório.
 * @returns {string[]} Um array de mensagens prontas para enviar.
 */

function chunkLinesIntoMessages(lines) {
  if (!lines || lines.length === 0) {
    return [];
  }

  const chunks = [];
  // O cabeçalho agora fica fora do bloco de código para não usar a fonte monoespaçada.
  const header = lines.shift(); // Remove a primeira linha (cabeçalho) e a guarda.
  let currentMessageBody = "";

  for (const line of lines) {
    if (currentMessageBody.length + line.length + 1 > MESSAGE_LIMIT - 10) {
      // -10 para dar margem para as crases e \n
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

  // Agora, montamos as mensagens finais
  const finalMessages = [];
  // Adiciona o cabeçalho como a primeira mensagem, sem formatação de código
  finalMessages.push(header);

  // Adiciona os outros pedaços, cada um dentro de um bloco de código
  for (const chunk of chunks) {
    finalMessages.push("```\n" + chunk + "\n```");
  }

  return finalMessages;
}

const toObjectId = (idString) => new mongoose.Types.ObjectId(idString);

export async function calculateTotalIncome(
  userId,
  month = null,
  categoryName = null
) {
  try {
    const pipeline = [];

    let initialMatch = { userId, type: "income" };
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
          let: { category_id_str: "$categoryId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", { $toObjectId: "$$category_id_str" }] },
              },
            },
            {
              $match: {
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
    let initialMatch = { userId, type: "expense" };
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
          let: { category_id_str: "$categoryId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", { $toObjectId: "$$category_id_str" }] },
              },
            },
            {
              $match: {
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
    { $match: { userId, type: "expense", date: { $gte: startDate } } },
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
    { $match: { userId, type: "expense", date: { $gte: startDate } } },
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
    let matchStage = { userId, type: "expense" };

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
          `\u00A0\u00A0\u00A0\u00A0💸 ${
            expense.description
          }: R$ ${expense.amount.toFixed(2)} (#_${expense.messageId}_)`
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
          `\u00A0\u00A0\u00A0\u00A0💸 ${
            expense.description
          }: R$ ${expense.amount.toFixed(2)} (#_${expense.messageId}_)`
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
    let matchStage = { userId, type: "income" };
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
      return `\u00A0\u00A0\u00A0\u00A0💰 ${
        income.description
      } (em _${catName}_): R$ ${income.amount.toFixed(2)} (#_${
        income.messageId
      }_)`;
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
    userId,
    date: { $gte: new Date() },
  }).sort({ date: "asc" });

  if (allFutureRemindersArray.length === 0) {
    return "Você não tem nenhum lembrete futuro. ✨";
  }

  const allFutureReminders = allFutureRemindersArray
    .map((r) => {
      const formattedDate = formatInBrazil(r.date);
      const messageCode = r.messageId ? `#_${r.messageId}_` : "";
      return `🗓️ ${r.description.toUpperCase()} - *${formattedDate}* ${messageCode}`;
    })
    .join("\n\n");

  return `🔔 *Seus próximos lembretes:*\n\n${allFutureReminders}`;
}
