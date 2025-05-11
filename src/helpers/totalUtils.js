import Expense from "../models/Expense.js";
import Income from "../models/Income.js";
import Reminder from "../models/Reminder.js";
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

export async function calculateTotalExpenses(userId, category = null, type) {
  const filter = category
    ? { userId, category: { $regex: new RegExp(`^${category.trim()}$`, "i") } }
    : { userId };

  if (type === "income") {
    const result = await Income.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return result.length ? result[0].total : 0;
  } else {
    const result = await Expense.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return result.length ? result[0].total : 0;
  }
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

export async function getTotalReminders(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const allFutureRemindersArray = await Reminder.find({
    userId,
    date: { $gte: today },
  });

  const data = allFutureRemindersArray.map(({ description, date }) => ({
    description,
    date,
  }));

  for (let i = 0; i < allFutureRemindersArray.length; i++) {
    data[i] = {
      description: allFutureRemindersArray[i].description,
      date: allFutureRemindersArray[i].date,
      messageId: allFutureRemindersArray[i].messageId,
    };
  }

  const allFutureReminders = data
    .map((r) => {
      const dateObj = new Date(r.date);
      dateObj.setMinutes(dateObj.getMinutes() + dateObj.getTimezoneOffset());
      const formattedDate = dateObj.toLocaleDateString("pt-BR");
      const messageCode = r.messageId ? `#${r.messageId}` : "";
      return `🗓️ ${r.description.toUpperCase()} - ${formattedDate} - ${messageCode}`;
    }).join("\n\n");

  return allFutureReminders;
}
