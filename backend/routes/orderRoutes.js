const express = require("express");
const router = express.Router();
const { createOrder, getOrder, getMyOrders } = require("../controllers/orderController");
const { protect } = require("../middleware/auth");

// POST /api/orders - Create order (the handler needs a logged-in user; store checkout uses /api/store/create-order)
router.post("/", protect, createOrder);

// Protected routes - require auth
router.get("/", protect, getMyOrders);
router.get("/:id", protect, getOrder);

module.exports = router;
