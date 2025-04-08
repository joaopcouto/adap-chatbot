import mongoose from "mongoose";
import UserStats from "../models/UserStats.js";   
import dayjs from "dayjs";

export async function updateMonthlySpending() {
    try {
        const currentMonth = dayjs().subtract(1, "month").format('YYYY-MM');

        const userStatsList = await UserStats.find({});
        console.log(`Usuários encontrados: ${userStatsList.length}`);

        const updates = userStatsList.map(async (user) => {
            
            console.log(`Usuário ${user._id} - totalSpent: ${user.totalSpent}`);
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

const dbName = "prod";

mongoose.connect("mongodb+srv://joaopc:jp2209@cluster0.x9s5k.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
    dbName,
})
    .then(() => {
        console.log("Conectado ao MongoDB");
        return updateMonthlySpending();
    })
    .then(() => {
        console.log("Finalizado com sucesso");
        mongoose.disconnect();
    })
    .catch((err) => {
        console.error("Erro na conexão com o MongoDB ou na atualização:", err);
    });