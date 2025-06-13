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

export async function getExpenseDetails(userId, month, monthName, category) {
  try {
    // ... (a lógica de 'matchStage' e 'Expense.find' continua a mesma) ...
    let matchStage = { userId };
    if (category) { matchStage.category = { $regex: new RegExp(`^${category.trim()}$`, "i") }; }
    if (month) {
      const [year, monthNumber] = month.split("-");
      matchStage.date = {
        $gte: new Date(Date.UTC(parseInt(year), parseInt(monthNumber)-1, 1, 0, 0, 0)),
        $lte: new Date(Date.UTC(parseInt(year), parseInt(monthNumber), 0, 23, 59, 59))
      }
    }
    const expenses = await Expense.find(matchStage).sort({ category: 1, date: 1 }); // Ordena por categoria primeiro!

    if (expenses.length === 0) { return "Nenhum gasto encontrado para este período."; }

    // ==================================================================
    // NOVA LÓGICA DE AGRUPAMENTO
    // ==================================================================
    
    // Se uma categoria específica foi pedida, mantenha a lista simples
    if (category) {
      let message = `Detalhes dos gastos em _*${category}*_ no mês de _*${monthName}*_:\n`;
      expenses.forEach(expense => {
        message += `- ${expense.description}: R$ ${expense.amount.toFixed(2)}\n`;
      });
      return message.trimEnd();
    }

    // Se NENHUMA categoria foi pedida, agrupe os resultados
    let message = `Detalhes de todos os gastos no mês de _*${monthName}*_:\n\n`;
    const expensesByCategory = {};

    // 1. Agrupe as despesas em um objeto
    expenses.forEach(expense => {
      const cat = expense.category || "Sem Categoria";
      if (!expensesByCategory[cat]) {
        expensesByCategory[cat] = [];
      }
      expensesByCategory[cat].push(`- ${expense.description}: R$ ${expense.amount.toFixed(2)}`);
    });

    // 2. Construa a mensagem a partir do objeto agrupado
    for (const cat in expensesByCategory) {
      message += `*${cat.charAt(0).toUpperCase() + cat.slice(1)}*\n`;
      message += expensesByCategory[cat].join('\n');
      message += '\n\n';
    }

    return message.trimEnd();

  } catch (error) {
    console.error("Erro ao buscar despesas por categoria:", error);
    return "Ocorreu um erro ao buscar os gastos. Tente novamente.";
  }
}

// Substitua também a função getIncomeDetails para corrigir o mesmo bug proativamente

export async function getIncomeDetails(userId, month, monthName, category) {
  try {
    let matchStage = { userId };

    if (category) {
      matchStage.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
    }

    if (month) {
      const [year, monthNumber] = month.split("-");
      matchStage.date = {
        $gte: new Date(Date.UTC(parseInt(year), parseInt(monthNumber)-1, 1, 0, 0, 0)),
        $lte: new Date(Date.UTC(parseInt(year), parseInt(monthNumber), 0, 23, 59, 59))
      }
    }

    const incomes = await Income.find(matchStage).sort({ date: 1 });

    if (incomes.length === 0) {
      return "Nenhuma receita encontrada para este período.";
    }
    
    // ==================================================================
    // A MESMA CORREÇÃO APLICADA AQUI
    // ==================================================================
    let header;
    if (category) {
      // Se TEM categoria, use um cabeçalho específico
      header = `Detalhes das receitas de _*${category}*_ no mês de _*${monthName}*_:\n`;
    } else {
      // Se NÃO TEM categoria, use um cabeçalho geral
      header = `Detalhes de todas as receitas no mês de _*${monthName}*_:\n`;
    }
    
    let message = header;
    incomes.forEach(income => {
      message += `✅ ${income.description}: R$ ${income.amount.toFixed(2)}\n`;
    });

    return message.trimEnd();

  } catch (error) {
    console.error("Erro ao buscar detalhes das receitas:", error);
    return "Ocorreu um erro ao buscar os detalhes das receitas. Tente novamente.";
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
