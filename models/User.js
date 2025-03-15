const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phone: { type: String, required: true },
  registered: { type: Boolean, default: false },
  balance: { type: Number, default: 0 },
  balanceHistory: [{ amount: Number, date: Date }],
  referredBy: { type: String, default: null },
  isStudent: { type: Boolean, default: false },
});

module.exports = mongoose.model("User", userSchema);