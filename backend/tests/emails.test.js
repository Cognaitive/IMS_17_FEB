const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const { escapeHtml, escapeFields } = require("../utils/escapeHtml");

describe("email HTML escaping", () => {
  const sent = [];
  const realCreateTransport = nodemailer.createTransport;

  before(() => {
    nodemailer.createTransport = () => ({ sendMail: async (mail) => sent.push(mail) });
  });
  after(() => {
    nodemailer.createTransport = realCreateTransport;
  });

  it("escapes HTML special characters", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    assert.equal(escapeHtml(undefined), "");
    assert.deepEqual(escapeFields({ name: "<b>", pincode: 110007 }), { name: "&lt;b&gt;", pincode: 110007 });
  });

  it("does not let a support message inject links into the ticket email", async () => {
    const emailService = require("../utils/emailService");
    await emailService.sendTicketRaisedNotification({
      _id: new mongoose.Types.ObjectId(),
      email: "customer@example.com",
      firstName: "<img src=x>",
      lastName: "",
      message: `Refund here: <a href="https://phish.example">samaywatch.in/refund</a>`,
    });

    const html = sent.at(-1).html;
    assert.ok(!html.includes(`<a href="https://phish.example"`));
    assert.ok(!html.includes("<img src=x>"));
    assert.ok(html.includes("&lt;a href=&quot;https://phish.example&quot;&gt;"));
  });

  it("sendOwnerNewOrderAlert emails the store owner with order summary", async () => {
    process.env.EMAIL_USER = process.env.EMAIL_USER || "test@example.com";
    process.env.EMAIL_PASS = process.env.EMAIL_PASS || "test-pass";
    process.env.OWNER_NOTIFY_EMAIL = "hiteshkathpal20@gmail.com";

    const emailService = require("../utils/emailService");
    assert.equal(typeof emailService.sendOwnerNewOrderAlert, "function");

    await emailService.sendOwnerNewOrderAlert({
      _id: new mongoose.Types.ObjectId(),
      orderNumber: "ORD-TESTOWNER",
      paymentStatus: "paid",
      total: 12594,
      items: [{ name: "Armani Exchange Watch", quantity: 1, price: 12594 }],
      shippingAddress: {
        name: "Nivedita",
        phone: "9999999999",
        email: "customer@example.com",
        address: "12 Test Street",
        city: "Delhi",
        state: "Delhi",
        pincode: "110007",
      },
    });

    const mail = sent.at(-1);
    assert.equal(mail.to, "hiteshkathpal20@gmail.com");
    assert.match(mail.subject, /ORD-TESTOWNER/);
    assert.ok(mail.html.includes("Nivedita"));
    assert.ok(mail.html.includes("Armani Exchange Watch"));
    assert.ok(mail.html.includes("12594") || mail.html.includes("12,594"));
    assert.ok(mail.html.includes("paid"));
    assert.ok(mail.html.includes("12 Test Street"));
  });
});
