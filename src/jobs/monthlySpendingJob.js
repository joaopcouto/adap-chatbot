import cron from "node-cron";
import updateMonthlySpending from "../services/updateMonthlySpending";

cron.schedule('0 0 1 * *', () => {
    console.log('🕒Rodando função de reset e histórico mensal...');
    updateMonthlySpending();
});