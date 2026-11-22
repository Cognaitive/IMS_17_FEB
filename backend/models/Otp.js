const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
  },
  mobile: {
    type: String,
  },
  otp: {
    type: String,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300, // 300 seconds = 5 minutes
  },
});

module.exports = mongoose.model("Otp", otpSchema);
