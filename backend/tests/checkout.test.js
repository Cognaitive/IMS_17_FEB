const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { app, request, startDb, stopDb, clearDb, createUser } = require("./setup");
const razorpay = require("../config/razorpay");
const { Product } = require("../models/Product");
const Order = require("../models/Order");

describe("store checkout and webhook", () => {
  const razorpayOrders = [];
  const realCreate = razorpay.orders.create;
  let watch;

  before(async () => {
    await startDb();
    razorpay.orders.create = async (options) => {
      const created = { id: `order_test_${razorpayOrders.length + 1}`, amount: options.amount };
      razorpayOrders.push(created);
      return created;
    };
  });
  after(async () => {
    razorpay.orders.create = realCreate;
    await stopDb();
  });
  beforeEach(async () => {
    await clearDb();
    await createUser({ role: "Owner" });
    watch = await Product.create({ brand: "Tissot", sku: "T-100", title: "Tissot PRX", price: 30000, inventory: 2, images: ["https://cdn.example.com/a.webp"] });
  });

  it("charges the database price plus shipping, ignoring a price sent by the browser", async () => {
    const res = await request(app)
      .post("/api/store/create-order")
      .send({ items: [{ productId: watch._id, quantity: 1, price: 1 }] });

    assert.equal(res.status, 200);
    assert.equal(razorpayOrders.at(-1).amount, (30000 + 99) * 100);
    const order = await Order.findOne({ razorpayOrderId: razorpayOrders.at(-1).id });
    assert.equal(order.paymentStatus, "pending");
    assert.equal(order.total, 30099);
  });

  it("refuses more units than are in stock", async () => {
    const res = await request(app)
      .post("/api/store/create-order")
      .send({ items: [{ productId: watch._id, quantity: 3 }] });
    assert.equal(res.status, 400);
  });

  it("no longer accepts the removed TEST1 coupon", async () => {
    const res = await request(app)
      .post("/api/store/create-order")
      .send({ items: [{ productId: watch._id, quantity: 1 }], couponCode: "TEST1" });
    assert.equal(res.status, 400);
  });

  it("rejects an unsigned payment confirmation", async () => {
    await request(app).post("/api/store/create-order").send({ items: [{ productId: watch._id, quantity: 1 }] });
    const res = await request(app).post("/api/store/verify-payment").send({
      razorpay_order_id: razorpayOrders.at(-1).id,
      razorpay_payment_id: "pay_fake",
      razorpay_signature: "not-a-real-signature",
    });
    assert.equal(res.status, 400);
    assert.equal((await Product.findById(watch._id)).inventory, 2);
  });

  it("rejects Shiprocket webhooks in production when no token is configured", async () => {
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app).post("/api/store/shiprocket/webhook").send({ awb: "123", current_status: "DELIVERED" });
      assert.equal(res.status, 503);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  it("rejects Shiprocket webhooks with the wrong token", async () => {
    process.env.SHIPROCKET_WEBHOOK_TOKEN = "right-token";
    try {
      const res = await request(app)
        .post("/api/store/shiprocket/webhook")
        .set("x-api-key", "wrong-token")
        .send({ awb: "123", current_status: "DELIVERED" });
      assert.equal(res.status, 401);
    } finally {
      process.env.SHIPROCKET_WEBHOOK_TOKEN = "";
    }
  });

  it("rejects courier webhook alias with the wrong token (same handler)", async () => {
    process.env.SHIPROCKET_WEBHOOK_TOKEN = "right-token";
    try {
      const res = await request(app)
        .post("/api/store/courier/webhook")
        .set("x-api-key", "wrong-token")
        .send({ awb: "123", current_status: "DELIVERED" });
      assert.equal(res.status, 401);
    } finally {
      process.env.SHIPROCKET_WEBHOOK_TOKEN = "";
    }
  });
});
