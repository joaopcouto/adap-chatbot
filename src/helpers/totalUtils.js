import Transaction from "../models/Transaction.js";
import Category from "../models/Category.js";
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

export async function calculateTotalExpenses(userId, categoryName = null, type) {
  let filter = { userId, type };
  
  if (categoryName) {
    // Find category by name for this user
    const category = await Category.findOne({ 
      userId, 
      name: { $regex: new RegExp(`^${categoryName.trim()}$`, "i") } 
    });
    
    if (category) {
      filter.categoryId = category._id.toString();
    } else {
      // If category not found, return 0
      return 0;
    }
  }

  const result = await Transaction.aggregate([
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

  return Transaction.aggregate([
    { $match: { userId, type: "expense", date: { $gte: startDate } } },
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

  return Transaction.aggregate([
    { $match: { userId, type: "expense", date: { $gte: startDate } } },
    {
      $addFields: {
        categoryObjectId: { $toObjectId: "$categoryId" }
      }
    },
    {
      $lookup: {
        from: "categories",
        localField: "categoryObjectId",
        foreignField: "_id",
        as: "category"
      }
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
