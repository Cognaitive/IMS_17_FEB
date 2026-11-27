/**
 * Restore Product.updatedAt after authorship backfill accidentally bumped timestamps.
 * Uses latest ActivityLog CREATE|UPDATE createdAt when available; otherwise leaves as-is.
 *
 * Usage: node scripts/repairListingUpdatedAt.js [--dry-run]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { Product } = require("../models/Product");
const ActivityLog = require("../models/ActivityLog");

const dryRun = process.argv.includes("--dry-run");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(dryRun ? "DRY RUN" : "Repairing updatedAt from ActivityLog…");

  const lasts = await ActivityLog.aggregate([
    {
      $match: {
        actionType: { $in: ["CREATE", "UPDATE"] },
        productId: { $ne: null },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$productId",
        at: { $first: "$createdAt" },
      },
    },
  ]);

  console.log(`ActivityLog tips: ${lasts.length}`);
  let updated = 0;
  const bulk = [];

  for (const row of lasts) {
    if (!row.at) continue;
    bulk.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { updatedAt: row.at } },
        timestamps: false,
      },
    });
    updated++;
    if (!dryRun && bulk.length >= 500) {
      await Product.bulkWrite(bulk, { ordered: false });
      bulk.length = 0;
    }
  }

  if (!dryRun && bulk.length > 0) {
    await Product.bulkWrite(bulk, { ordered: false });
  }

  console.log({ repaired: updated, dryRun });
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
