import UserStats from "../models/UserStats.js";   
import dayjs from "dayjs";

export async function updateMonthlySpending() {
    try {
        const currentMonth = dayjs().subtract(1, "month").format('YYYY-MM');

        const userStatsList = await UserStats.find({});

        const updates = userStatsList.map(async (user) => {

            user.spendingHistory.push({
                month: currentMonth,
                amount: user.totalSpent
            });

            if (user.spendingHistory.length > 3) {
                user.spendingHistory = user.spendingHistory.slice(-3);
            }

            user.totalSpent = 0;

            return user.save();
        });
        await Promise.all(updates);
        console.log("Histórico mensal atualizado com os últimos 3 meses.");
    } catch (error) {
        console.error("Erro ao atualizar histórico mensal:", error);
    }
}