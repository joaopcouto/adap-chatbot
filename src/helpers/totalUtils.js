import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
import Reminder from "../models/Reminder.js";
import UserStats from "../models/UserStats.js";
import { TIMEZONE } from "../utils/dateUtils.js"; 
import { formatInBrazil } from "../utils/dateUtils.js"; 

export async function calculateTotalIncome(userId, month = null) {
  let matchStage = { userId };

  if (month) {
    matchStage.$expr = {
      $eq: [
        { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } },
        month
      ],
    };
  }

  try {
    const result = await Income.aggregate([
      { $match: matchStage },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return result.length > 0 ? result[0].total : 0;
  } catch (err) {
    console.error("Erro ao buscar total de receita:", err);
    return 0;
  }
}

export async function calculateTotalExpenses(
  userId,
  category = null,
  month = null
) {
  let matchStage = { userId };

  if (category) {
    matchStage.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
  }

  if (month) {
    matchStage.$expr = {
      $eq: [
        { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } },
        month
      ],
    };
  }

  try {
    const result = await Expense.aggregate([
      { $match: matchStage },
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
  startDate.setDate(startDate.getDate() - (days + 1));
  
  const todayInBrazil = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }); 

  return Expense.aggregate([
    { $match: { userId, date: { $gte: startDate } } },
    { $addFields: {
        brazilDateStr: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TIMEZONE } }
      }
    },
    { $match: {
        brazilDateStr: { $lte: todayInBrazil }
      }
    },
    {
      $group: {
        _id: "$category.name",
        total: { $sum: "$amount" },
      },
    },
  ]);
}

export async function getExpenseDetails(userId, month, monthName, category) {
  try {
    let matchStage = { userId };
    
    if (category) {
      matchStage.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
    }
    
    if (month) {
      matchStage.$expr = {
        $eq: [
          { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } },
          month
        ],
      };
    }
    
    const expenses = await Expense.aggregate([
      { $match: matchStage },
      { $sort: { category: 1, date: 1 } }
    ]);

    if (expenses.length === 0) {
      return "Nenhum gasto encontrado para este período.";
    }

    if (category) {
      let message = `🧾 Detalhes dos gastos em _*${category}*_ no mês de _*${monthName}*_:\n`;
      expenses.forEach((expense) => {
        message += `   💸 ${expense.description}: R$ ${expense.amount.toFixed(
          2
        )} \n`;
      });
      return message.trimEnd();
    }

    let message = `🧾 Detalhes de todos os gastos no mês de _*${monthName}*_:\n\n`;
    const expensesByCategory = {};

    expenses.forEach((expense) => {
      const cat = expense.category || "Sem Categoria";
      if (!expensesByCategory[cat]) {
        expensesByCategory[cat] = [];
      }
      expensesByCategory[cat].push(
        `   💸 ${expense.description}: R$ ${expense.amount.toFixed(2)}`
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

export async function getIncomeDetails(userId, month, monthName, category) {
  try {
    let matchStage = { userId };

    if (category) {
      matchStage.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
    }

    if (month) {
       matchStage.$expr = {
        $eq: [
          { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } },
          month
        ],
      };
    }

    const incomes = await Income.aggregate([
      { $match: matchStage },
      { $sort: { date: 1 } }
    ]);

    if (incomes.length === 0) {
      return "Nenhuma receita encontrada para este período.";
    }
    
    let header;
    if (category) {
      header = `🧾 Detalhes das receitas de _*${category}*_ no mês de _*${monthName}*_:\n`;
    } else {
      header = `🧾 Detalhes de todas as receitas no mês de _*${monthName}*_:\n`;
    }

    let message = header;
    incomes.forEach((income) => {
      message += `   💰 ${income.description}: R$ ${income.amount.toFixed(
        2
      )}\n`;
    });

    return message.trimEnd();
  } catch (error) {
    console.error("Erro ao buscar detalhes das receitas:", error);
    return "Ocorreu um erro ao buscar os detalhes das receitas. Tente novamente.";
  }
}

// Helper function to get or create a category
export async function getOrCreateCategory(userId, categoryName) {
  let category = await Category.findOne({ userId, name: categoryName });
  
  if (!category) {
    category = new Category({
      userId,
      name: categoryName,
      color: "#3498db" // Default color
    });
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