import Permissions from "../models/Permissions.js";
import UserStats from "../models/UserStats.js";

export const hasAccessToFeature = async (userId, productId) => {
    console.log("Buscando com:", { userId, productId });

    const user = await Permissions.findOne({ userId, productId }).lean();

    console.log("Resultado da query:", user);

    return user?.access;
};