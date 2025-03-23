import mongoose from "mongoose";

export function connectToDatabase() {
  const dbName = process.env.NODE_ENV === "prod" ? "prod" : "test";
  return mongoose.connect(process.env.MONGO_URI, {
    dbName,
  });
}