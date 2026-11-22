const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { app, request, startDb, stopDb, clearDb, createUser } = require("./setup");
const Otp = require("../models/Otp");
const User = require("../models/User");

describe("OTP verification", () => {
  before(startDb);
  after(stopDb);
  beforeEach(clearDb);

  it("rejects a query object instead of a code on password reset", async () => {
    const owner = await createUser({ role: "Owner" });
    await Otp.create({ email: owner.email, otp: "4821" });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: owner.email, otp: { $ne: "0000" }, password: "attacker-pass" });

    assert.equal(res.status, 400);
    const stored = await User.findById(owner._id).select("+password");
    assert.equal(await stored.matchPassword("password123"), true);
  });

  it("rejects a query object instead of a code on email login", async () => {
    const customer = await createUser();
    await Otp.create({ email: customer.email, otp: "123456" });

    const res = await request(app)
      .post("/api/auth/email-login/verify-otp")
      .send({ email: customer.email, otp: { $ne: "000000" } });

    assert.equal(res.status, 400);
    assert.equal(res.body.token, undefined);
  });

  it("burns the code after 5 wrong guesses", async () => {
    const customer = await createUser();
    await Otp.create({ email: customer.email, otp: "123456" });

    for (let i = 0; i < 5; i++) {
      const wrong = await request(app)
        .post("/api/auth/email-login/verify-otp")
        .send({ email: customer.email, otp: String(100000 + i) });
      assert.equal(wrong.status, 400);
    }

    const right = await request(app)
      .post("/api/auth/email-login/verify-otp")
      .send({ email: customer.email, otp: "123456" });
    assert.equal(right.status, 400);
  });

  it("logs in with the correct code once, then the code is gone", async () => {
    const customer = await createUser();
    await Otp.create({ email: customer.email, otp: "654321" });

    const first = await request(app)
      .post("/api/auth/email-login/verify-otp")
      .send({ email: customer.email, otp: "654321" });
    assert.equal(first.status, 200);
    assert.ok(first.body.token);

    const replay = await request(app)
      .post("/api/auth/email-login/verify-otp")
      .send({ email: customer.email, otp: "654321" });
    assert.equal(replay.status, 400);
  });

  it("resets the password with the correct code", async () => {
    const customer = await createUser();
    await Otp.create({ email: customer.email, otp: "4821" });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: customer.email, otp: "4821", password: "new-password" });

    assert.equal(res.status, 200);
    const stored = await User.findById(customer._id).select("+password");
    assert.equal(await stored.matchPassword("new-password"), true);
  });
});
