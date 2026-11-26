// Read-only: lists every account that can open the IMS, to spot website customers who got
// the old default role "admin". Run from backend/: node scripts/audit_user_roles.js
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Order = require("../models/Order");

const IMS_ROLES = /^(owner|admin|staff|head)$/i;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const users = await User.find({ role: IMS_ROLES })
    .select("name email role parentId addresses createdAt")
    .sort({ createdAt: 1 })
    .lean();
  const orderCounts = new Map(
    (await Order.aggregate([{ $group: { _id: "$user", count: { $sum: 1 } } }])).map((o) => [String(o._id), o.count])
  );

  console.table(users.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    createdBy: u.parentId ? String(u.parentId) : "",
    savedAddresses: u.addresses?.length || 0,
    orders: orderCounts.get(String(u._id)) || 0,
    created: u.createdAt?.toISOString().slice(0, 10),
  })));
  console.log(`${users.length} accounts can open the IMS. Customers usually show saved addresses and no "createdBy"; the Owner also holds every guest order.`);

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
