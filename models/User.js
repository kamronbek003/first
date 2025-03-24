const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phone: { type: String, required: true },
  registered: { type: Boolean, default: false },
  balance: { type: Number, default: 0 },
  balanceHistory: [{
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    isBonus: { type: Boolean, default: false }
  }],
  referredBy: { type: String, default: null },
  presentations: [{
    authorName: String,
    topic: String,
    filePath: String,
    templateId: Number,
    createdAt: { type: Date, default: Date.now }
  }],
  isStudent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);