/**
 * One-off: send owner new-order alert for a single existing paid order.
 * Usage: node scripts/send_owner_alert_once.js ORD-BD6E17
 */
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const Order = require("../models/Order");
require("../models/User");
const emailService = require("../utils/emailService");

async function run() {
  const orderNumber = process.argv[2];
  if (!orderNumber) {
    console.error("Usage: node scripts/send_owner_alert_once.js <ORDER_NUMBER>");
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error("Missing MONGODB_URI in backend/.env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const order = await Order.findOne({ orderNumber }).populate("user", "email name");
  if (!order) {
    console.error(`Order not found: ${orderNumber}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found ${order.orderNumber} paymentStatus=${order.paymentStatus} total=${order.total}`);
  const info = await emailService.sendOwnerNewOrderAlert(order);
  if (info?.simulated) {
    console.log("Simulated only (EMAIL_USER/EMAIL_PASS missing).");
  } else {
    console.log("Owner alert send succeeded.");
    if (info?.messageId) console.log("Message ID:", info.messageId);
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Owner alert send failed:", err.message || err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
