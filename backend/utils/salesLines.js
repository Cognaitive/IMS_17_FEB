// Aggregation stages that turn paid online orders and imported store invoices into one stream of
// sales lines: { date, channel, productId, brand, sku, quantity, amount }.
// Run them on the Order collection: Order.aggregate([...salesLinesPipeline(from, to), ...]).
//
// Online amounts are the item price (GST inclusive) with the order's coupon discount spread across
// items in proportion to their value. Shipping is not counted as sales.
function salesLinesPipeline(from, to) {
  return [
    { $match: { paymentStatus: "paid", orderStatus: { $ne: "cancelled" } } },
    {
      $addFields: {
        date: { $ifNull: ["$paidAt", "$createdAt"] },
        netFactor: {
          $cond: [
            { $gt: ["$subtotal", 0] },
            { $divide: [{ $subtract: ["$subtotal", { $ifNull: ["$discountAmount", 0] }] }, "$subtotal"] },
            1,
          ],
        },
      },
    },
    { $match: { date: { $gte: from, $lt: to } } },
    { $unwind: "$items" },
    {
      $lookup: {
        from: "products",
        localField: "items.product",
        foreignField: "_id",
        pipeline: [{ $project: { brand: 1, sku: 1 } }],
        as: "product",
      },
    },
    {
      $project: {
        _id: 0,
        date: 1,
        channel: { $literal: "online" },
        productId: "$items.product",
        brand: { $ifNull: [{ $first: "$product.brand" }, "Unknown"] },
        sku: { $ifNull: [{ $first: "$product.sku" }, ""] },
        quantity: "$items.quantity",
        amount: { $multiply: ["$items.price", "$items.quantity", "$netFactor"] },
      },
    },
    {
      $unionWith: {
        coll: "salesinvoices",
        pipeline: [
          { $match: { invoiceDate: { $gte: from, $lt: to } } },
          { $unwind: "$lines" },
          {
            $project: {
              _id: 0,
              date: "$invoiceDate",
              channel: "$channel",
              productId: "$lines.product",
              brand: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$lines.brand", ""] } }, 0] }, "$lines.brand", "Unknown"] },
              sku: "$lines.sku",
              quantity: "$lines.quantity",
              amount: "$lines.amount",
            },
          },
        ],
      },
    },
  ];
}

module.exports = { salesLinesPipeline };
