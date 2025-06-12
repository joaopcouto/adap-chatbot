import Expense from "../models/Expense.js";
import Income from "../models/Income.js";
import Reminder from "../models/Reminder.js";
import UserStats from "../models/UserStats.js";


export async function calculateTotalIncome(userId, month = null) {
  let matchStage = { userId };

  if (month) {
    const [year, monthNumber] = month.split("-");
    matchStage.$expr = {
      $and: [
        { $eq: [{ $year: "$date" }, parseInt(year)] },
        { $eq: [{ $month: "$date" }, parseInt(monthNumber)] }
      ]
    };
  }

  try {
    const result = await Income.aggregate([
      { $match: matchStage },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    return result.length > 0 ? result[0].total : 0;
  } catch (err) {
    console.error("Erro ao buscar total de receita:", err);
    return 0;
  }
}

export async function calculateTotalExpenses(userId, category = null, month = null) {
  let matchStage = { userId };

  if (category) {
    matchStage.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
  }

  if (month) {
    const [year, monthNumber] = month.split("-");
    matchStage.date= {
      $gte: new Date(Date.UTC(parseInt(year), parseInt(monthNumber)-1, 1, 0, 0, 0)),
      $lte: new Date(Date.UTC(parseInt(year), parseInt(monthNumber), 0, 23, 59, 59))
    }
  }

  try {
    const result = await Expense.aggregate([
      { $match: matchStage },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    return result.length > 0 ? result[0].total : 0;
  } catch (err) {
    console.error("Erro ao buscar total de gastos:", err);
    return 0;
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

// Função para formatar a detalhes de despesas por categoria
export async function getCategoryExpenses(userId, month, monthName, category) {
  try {
    let matchStage = { userId };

    if (category) {
      matchStage.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
    }

    if (month) {
      const [year, monthNumber] = month.split("-");
      matchStage.date= {
        $gte: new Date(Date.UTC(parseInt(year), parseInt(monthNumber)-1, 1, 0, 0, 0)),
        $lte: new Date(Date.UTC(parseInt(year), parseInt(monthNumber), 0, 23, 59, 59))
      }
    }

    const expenses = await Expense.find(matchStage);
    if (expenses.length === 0) {
      return "Nenhum gasto encontrado para este mês e categoria.";
    }
    
    
    let message = `Detalhes dos gastos em _*${category}*_ no mês de _*${monthName}*_:\n`;
    expenses.forEach(expense => {
      message += `- ${expense.description}: R$ ${expense.amount.toFixed(2)}\n`;
    });
    
    return message;
  } catch (error) { // 👈 ADICIONANDO O BLOCO CATCH
    console.error("Erro ao buscar despesas por categoria:", error);
    return "Ocorreu um erro ao buscar os gastos. Tente novamente.";
  }
}

export async function getCategoryIncomes(userId, month, category) {
  try {
    // Montar a query para buscar as receitas do usuário no mês e categoria especificados
    const query = {
      userId: userId,
      date: {
        $gte: new Date(`${month}-01T00:00:00.000Z`),
        $lte: new Date(`${month}-31T23:59:59.999Z`)
      }
    };

    // Se uma categoria for especificada, adicionar ao filtro
    if (category) {
      query.category = category;
    }

    // Buscar as receitas no banco de dados
    const incomes = await Income.find(query);

    // Retornar as receitas encontradas
    return incomes;
  } catch (error) {
    // Em caso de erro, registrar o erro e retornar um array vazio
    console.error("Erro ao buscar receitas por categoria:", error);
    return [];
  }
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
