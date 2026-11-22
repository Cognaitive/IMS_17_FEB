// Shared test harness: in-memory MongoDB and the Express app with every outside service switched off.
// Keys are set to "" (not deleted) so dotenv can't fill them from a real backend/.env.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.RAZORPAY_KEY_ID = "rzp_test_dummy";
process.env.RAZORPAY_KEY_SECRET = "test_razorpay_secret";
for (const key of [
  "MONGODB_URI", "EMAIL_HOST", "EMAIL_USER", "EMAIL_PASS",
  "DO_SPACES_KEY", "DO_SPACES_SECRET", "DO_SPACES_ENDPOINT", "DO_SPACES_BUCKET",
  "SHIPROCKET_EMAIL", "SHIPROCKET_PASSWORD", "SHIPROCKET_WEBHOOK_TOKEN",
]) {
  process.env[key] = "";
}

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const app = require("../server");
const User = require("../models/User");

let mongo;

async function startDb() {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}

async function stopDb() {
  await mongoose.disconnect();
  await mongo?.stop();
}

async function clearDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

let userCount = 0;
async function createUser(fields = {}) {
  userCount += 1;
  return User.create({
    name: `Test User ${userCount}`,
    email: `user${userCount}@example.com`,
    mobile: `90000000${String(userCount).padStart(2, "0")}`,
    password: "password123",
    role: "user",
    ...fields,
  });
}

const authHeader = (user) => ({ Authorization: `Bearer ${user.generateToken()}` });

module.exports = { app, request, startDb, stopDb, clearDb, createUser, authHeader };
