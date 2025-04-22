import Expense from "../models/Expense.js";
import Income from "../models/Income.js";
import UserStats from "../models/UserStats.js";

export async function getCurrentTotalIncome(userId) {
  try {
    const userStats = await UserStats.findOne({ userId });
    return userStats?.totalIncome || 0;
  } catch (err) {
    console.error("Erro ao buscar totalIncome:", err);
    return 0;
  }
}

export async function calculateTotalExpenses(userId, category = null) {   
  const filter = category
  ? { userId, category: { $regex: new RegExp(`^${category.trim()}$`, "i") } } 
  : { userId };
  const result = await Expense.aggregate([  
    { $match: filter },
    { $group: { _id: null, total: { $sum: "$amount" } } }, 
  ]);
  return result.length ? result[0].total : 0; 
}

export async function getCurrentTotalSpent(userId) {
  try {
    const userStats = await UserStats.findOne({ userId });
    return userStats?.totalSpent || 0;
  } catch (err) {
    console.error("Erro ao buscar totalSpent:", err);
    return 0;
  }
}

export async function getExpensesReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  return Expense.aggregate([
    { $match: { userId, date: { $gte: startDate } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

export async function getCategoryReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  return Expense.aggregate([
    { $match: { userId, date: { $gte: startDate } } },
    {
      $group: {
        _id: "$category",
        total: { $sum: "$amount" },
      },
    },
  ]);
}
