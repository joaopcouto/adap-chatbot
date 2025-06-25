import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
import Reminder from "../models/Reminder.js";
import { TIMEZONE, formatInBrazil } from "../utils/dateUtils.js";
import mongoose from "mongoose";

const toObjectId = (idString) => new mongoose.Types.ObjectId(idString);

export async function calculateTotalIncome(userId, month = null, categoryName = null) {
  try {
    const pipeline = [];

    let initialMatch = { userId, type: "income" };
    if (month) {
      initialMatch.$expr = {
        $eq: [ { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } }, month ],
      };
    }
    pipeline.push({ $match: initialMatch });
    
    if (categoryName) {
      pipeline.push({
        $lookup: {
          from: "categories",
          let: { category_id_str: "$categoryId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", { $toObjectId: "$$category_id_str" }] } } },
            { $match: { name: { $regex: new RegExp(`^${categoryName.trim()}$`, "i") } } }
          ],
          as: "categoryDoc"
        }
      });
      pipeline.push({ $match: { "categoryDoc": { $ne: [] } } });
    }
    
    pipeline.push({ $group: { _id: null, total: { $sum: "$amount" } } });
    const result = await Transaction.aggregate(pipeline);
    return result.length > 0 ? result[0].total : 0;
  } catch (err) {
    console.error("Erro ao buscar total de receita:", err);
    return 0;
  }
}

export async function calculateTotalExpenses(userId, categoryName = null, month = null) {
  try {
    const pipeline = [];
    let initialMatch = { userId, type: "expense" };
    if (month) {
      initialMatch.$expr = {
        $eq: [ { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } }, month ],
      };
    }
    pipeline.push({ $match: initialMatch });

    if (categoryName) {
      pipeline.push({
        $lookup: {
          from: "categories",
          let: { category_id_str: "$categoryId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", { $toObjectId: "$$category_id_str" }] } } },
            { $match: { name: { $regex: new RegExp(`^${categoryName.trim()}$`, "i") } } }
          ],
          as: "categoryDoc"
        }
      });
      pipeline.push({ $match: { "categoryDoc": { $ne: [] } } });
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
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TIMEZONE } },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: days }
  ]);
}

export async function getCategoryReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return Transaction.aggregate([
    { $match: { userId, type: 'expense', date: { $gte: startDate } } },
    {
      $lookup: {
        from: 'categories',
        let: { category_id_str: '$categoryId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', { $toObjectId: '$$category_id_str' }] } } }
        ],
        as: 'category'
      }
    },
    { $unwind: '$category' },
    {
      $group: {
        _id: "$category.name",
        total: { $sum: "$amount" },
      },
    },
  ]);
}

export async function getExpenseDetails(userId, month, monthName, categoryName) {
  try {
    let matchStage = { userId, type: "expense" };

    if (month) {
      matchStage.$expr = {
        $eq: [ { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } }, month ],
      };
    }
    
    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'categories',
          let: { category_id_str: '$categoryId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', { $toObjectId: '$$category_id_str' }] } } }
          ],
          as: 'category'
        }
      },
      { $unwind: '$category' }
    ];

    if (categoryName) {
        pipeline.push({
            $match: { 'category.name': { $regex: new RegExp(`^${categoryName.trim()}$`, "i") } }
        });
    }

    pipeline.push({ $sort: { 'category.name': 1, date: 1 } });
    
    const expenses = await Transaction.aggregate(pipeline);

    if (expenses.length === 0) {
      return "Nenhum gasto encontrado para este período.";
    }

    if (categoryName) {
      let message = `🧾 Detalhes dos gastos em _*${categoryName}*_ no mês de _*${monthName}*_:\n\n`;
      expenses.forEach((expense) => {
        message += `   💸 ${expense.description}: R$ ${expense.amount.toFixed(2)} (#_${expense.messageId}_)\n`;
      });
      return message.trimEnd();
    }

    let message = `🧾 Detalhes de todos os gastos no mês de _*${monthName}*_:\n\n`;
    const expensesByCategory = {};
    expenses.forEach((expense) => {
      const cat = expense.category.name || "Sem Categoria";
      if (!expensesByCategory[cat]) {
        expensesByCategory[cat] = [];
      }
      expensesByCategory[cat].push(
        `   💸 ${expense.description}: R$ ${expense.amount.toFixed(2)} (#_${expense.messageId}_)`
      );
    });

    for (const cat in expensesByCategory) {
      message += `📁 *${cat.charAt(0).toUpperCase() + cat.slice(1)}*\n`;
      message += expensesByCategory[cat].join("\n");
      message += "\n\n";
    }

    return message.trimEnd();
  } catch (error) {
    console.error("Erro ao buscar despesas por categoria:", error);
    return "Ocorreu um erro ao buscar os gastos. Tente novamente.";
  }
}

export async function getIncomeDetails(userId, month, monthName, categoryName) {
  try {
    let matchStage = { userId, type: "income" };
    if (month) {
       matchStage.$expr = {
        $eq: [ { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } }, month ],
      };
    }
    
    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'categories',
          let: { category_id_str: '$categoryId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', { $toObjectId: '$$category_id_str' }] } } }
          ],
          as: 'category'
        }
      },
      { $unwind: '$category' }
    ];

    if (categoryName) {
      pipeline.push({
        $match: { 'category.name': { $regex: new RegExp(`^${categoryName.trim()}$`, "i") } }
      });
    }

    pipeline.push({ $sort: { date: 1 } });

    const incomes = await Transaction.aggregate(pipeline);

    if (incomes.length === 0) {
      return "Nenhuma receita encontrada para este período.";
    }
    
    let header = categoryName
      ? `🧾 Detalhes das receitas de _*${categoryName}*_ no mês de _*${monthName}*_:\n`
      : `🧾 Detalhes de todas as receitas no mês de _*${monthName}*_:\n`;

    let message = header;
    incomes.forEach((income) => {
      const catName = income.category.name.charAt(0).toUpperCase() + income.category.name.slice(1);
      message += `   💰 ${income.description} (em _${catName}_): R$ ${income.amount.toFixed(2)} (#_${income.messageId}_)\n`;
    });

    return message.trimEnd();
  } catch (error) {
    console.error("Erro ao buscar detalhes das receitas:", error);
    return "Ocorreu um erro ao buscar os detalhes das receitas. Tente novamente.";
  }
}

export async function getOrCreateCategory(userId, categoryName) {
  const standardizedName = categoryName.trim().toLowerCase();
  let category = await Category.findOne({ userId, name: standardizedName });
  if (!category) {
    category = new Category({ userId, name: standardizedName, color: "#3498db" });
    await category.save();
  }
  return category;
}

export async function getTotalReminders(userId) {
  const allFutureRemindersArray = await Reminder.find({
    userId,
    date: { $gte: new Date() },
  }).sort({ date: 'asc' });

  if (allFutureRemindersArray.length === 0) {
    return 'Você não tem nenhum lembrete futuro. ✨';
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