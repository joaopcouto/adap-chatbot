import User from "../models/User.js";
import Permissions from "../models/Permissions.js";

export async function validateUserAccess(userId) {
    const user = await User.findOne({ phoneNumber: userId });
    
    if (!user) return { authorized: false };

    const hasPermission = await Permissions.findOne({ userId: user._id, access: true, productId: "chatbot" });

    if (!hasPermission) return { authorized: false };

    // Check if permission has expired
    if (hasPermission.expiresAt && new Date() > hasPermission.expiresAt) {
        return { authorized: false };
    }

    return { authorized: true, user };
}