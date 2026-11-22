const express = require("express");
const router = express.Router();
const {
  createRazorpayOrder,
  verifyPayment,
  validateCoupon,
  getMyOrders,
  getPaymentDetails,
  getOrderTracking,
  checkServiceability,
  handleShiprocketWebhook
} = require("../controllers/storeOrderController");
const { protect } = require("../middleware/auth");

router.post("/create-order", createRazorpayOrder);
router.post("/verify-payment", verifyPayment);
router.post("/validate-coupon", validateCoupon);
router.get("/my-orders", protect, getMyOrders);
router.get("/my-orders/:id/track", protect, getOrderTracking);
router.get("/payment-details/:paymentId", getPaymentDetails);

// Shiprocket Integration Endpoints
router.get("/shiprocket/serviceability", checkServiceability);
// Prefer /courier/webhook in Shiprocket UI — their form rejects URLs containing "shiprocket"
router.post("/courier/webhook", handleShiprocketWebhook);
router.post("/shiprocket/webhook", handleShiprocketWebhook);

module.exports = router;
