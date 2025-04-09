import UserStats from "../models/UserStats.js";

export const hasAcessToFeature = async (userId, featureName) => {
    const user = await UserStats.findOne({ userId });
    return user?.featuresUnlocked?.includes(featureName);
};