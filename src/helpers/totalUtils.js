import Expense from "../models/Expense.js";
import Income from "../models/Income.js";
import Reminder from "../models/Reminder.js";
import UserStats from "../models/UserStats.js";
import { TIMEZONE } from "../utils/dateUtils.js"; // Importe a constante de timezone
import { formatInBrazil } from "../utils/dateUtils.js"; // IMPORTAR a nossa função helper de data

// Função refatorada para usar timezone na query
export async function calculateTotalIncome(userId, month = null) {
  let matchStage = { userId };

  if (month) {
    // Usamos $expr para comparar o resultado de uma operação no documento.
    // Convertemos a data do BD para string no formato 'YYYY-MM' no fuso de SP
    // e comparamos com o mês solicitado.
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

// Função refatorada para usar timezone na query
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
    // A mesma lógica da receita se aplica aqui.
    // Se tivermos categoria e mês, o $match terá as duas condições.
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

// Função refatorada para agrupar por dia no fuso horário correto
export async function getExpensesReport(userId, days) {
  // Criamos uma data de início apenas para otimizar, para não escanear a coleção inteira.
  // Pegamos um dia a mais de 'gordura' para garantir que não vamos perder nada na borda do fuso horário.
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days + 1));

  return Expense.aggregate([
    { $match: { userId, date: { $gte: startDate } } },
    {
      $group: {
        // A mágica acontece aqui: agrupamos pela data convertida para o fuso de SP.
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TIMEZONE } },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { _id: 1 } }, // Ordena pela string de data, que funciona corretamente (YYYY-MM-DD)
    { $limit: days } // Limitamos ao número de dias que o usuário pediu
  ]);
}

// Função refatorada para considerar o período correto
export async function getCategoryReport(userId, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days + 1));
  
  // Pegar a data de hoje no fuso de SP para a comparação
  const todayInBrazil = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // 'en-CA' dá o formato YYYY-MM-DD

  return Expense.aggregate([
    // Filtro inicial otimizado
    { $match: { userId, date: { $gte: startDate } } },
    // Adiciona um campo com a data convertida
    { $addFields: {
        brazilDateStr: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TIMEZONE } }
      }
    },
    // Filtra para garantir que estamos apenas nos últimos 'days' dias do Brasil
    { $match: {
        brazilDateStr: { $lte: todayInBrazil }
      }
    },
    {
      $group: {
        _id: "$category",
        total: { $sum: "$amount" },
      },
    },
  ]);
}

// Função refatorada para buscar detalhes com base no mês do Brasil
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
    
    // O .find() não suporta $expr, então precisamos usar .aggregate()
    const expenses = await Expense.aggregate([
      { $match: matchStage },
      { $sort: { category: 1, date: 1 } }
    ]);

    if (expenses.length === 0) {
      return "Nenhum gasto encontrado para este período.";
    }

    // O resto da sua lógica de formatação da mensagem continua igual e funcionará
    // ... (código de formatação omitido por brevidade, é o mesmo que você já tem)
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

// Função refatorada para buscar detalhes com base no mês do Brasil
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
    
    // O resto da sua lógica de formatação da mensagem continua igual
    // ... (código de formatação omitido por brevidade)
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

// A função de lembretes já parece lidar bem com a formatação na exibição.
// O ajuste no `getTotalReminders` já está bom.
export async function getTotalReminders(userId) {
  // Esta função já formata na saída, o que é bom.
  // Vamos apenas garantir que a conversão seja explícita.
  const allFutureRemindersArray = await Reminder.find({
    userId,
    date: { $gte: new Date() }, // Podemos simplificar
  }).sort({ date: 'asc' });

  if (allFutureRemindersArray.length === 0) {
    return 'Você não tem nenhum lembrete futuro. ✨';
  }

  const allFutureReminders = allFutureRemindersArray
    .map((r) => {
      // Usamos nossa função helper para garantir consistência
      const formattedDate = formatInBrazil(r.date); 
      const messageCode = r.messageId ? `#_${r.messageId}_` : "";
      return `🗓️ ${r.description.toUpperCase()} - *${formattedDate}* ${messageCode}`;
    })
    .join("\n\n");

  return `🔔 *Seus próximos lembretes:*\n\n${allFutureReminders}`;
}