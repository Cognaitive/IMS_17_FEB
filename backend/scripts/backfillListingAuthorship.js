/**
 * Best-effort backfill of Product createdBy / updatedBy from existing data.
 * Does NOT invent history:
 *  - createdBy ← earliest ActivityLog CREATE for productId, else Product.user
 *  - updatedBy ← latest ActivityLog CREATE|UPDATE for productId, else createdBy
 *  - Names/emails from ActivityLog when present, else User collection lookup
 *
 * Usage: node scripts/backfillListingAuthorship.js [--dry-run]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { Product } = require("../models/Product");
const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI required");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(dryRun ? "DRY RUN — no writes" : "Backfilling listing authorship…");

  const userCache = new Map();
  const lookupUser = async (id) => {
    if (!id) return null;
    const key = String(id);
    if (userCache.has(key)) return userCache.get(key);
    const u = await User.findById(id).select("name email").lean();
    userCache.set(key, u || null);
    return u;
  };

  // Earliest CREATE per product
  const creates = await ActivityLog.aggregate([
    { $match: { actionType: "CREATE", productId: { $ne: null } } },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: "$productId",
        adminId: { $first: "$adminId" },
        adminName: { $first: "$adminName" },
        adminEmail: { $first: "$adminEmail" },
        at: { $first: "$createdAt" },
      },
    },
  ]);
  const createByProduct = new Map(creates.map((c) => [String(c._id), c]));

  // Latest CREATE or UPDATE per product
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
        adminId: { $first: "$adminId" },
        adminName: { $first: "$adminName" },
        adminEmail: { $first: "$adminEmail" },
        at: { $first: "$createdAt" },
      },
    },
  ]);
  const lastByProduct = new Map(lasts.map((c) => [String(c._id), c]));

  const cursor = Product.find({})
    .select("_id user createdBy updatedBy createdByName updatedByName")
    .lean()
    .cursor();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const bulk = [];

  for await (const product of cursor) {
    scanned++;
    const pid = String(product._id);
    const createLog = createByProduct.get(pid);
    const lastLog = lastByProduct.get(pid);

    let createdBy = createLog?.adminId || product.user || null;
    let createdByName = createLog?.adminName || "";
    let createdByEmail = createLog?.adminEmail || "";

    if (createdBy && (!createdByName || !createdByEmail)) {
      const u = await lookupUser(createdBy);
      if (u) {
        createdByName = createdByName || u.name || "";
        createdByEmail = createdByEmail || u.email || "";
      }
    }

    let updatedBy = lastLog?.adminId || createdBy || null;
    let updatedByName = lastLog?.adminName || createdByName || "";
    let updatedByEmail = lastLog?.adminEmail || createdByEmail || "";

    if (updatedBy && (!updatedByName || !updatedByEmail)) {
      const u = await lookupUser(updatedBy);
      if (u) {
        updatedByName = updatedByName || u.name || "";
        updatedByEmail = updatedByEmail || u.email || "";
      }
    }

    // Nothing trustworthy to stamp
    if (!createdBy && !updatedBy) {
      skipped++;
      continue;
    }

    // Already complete — skip overwrite
    if (
      product.createdBy &&
      product.updatedBy &&
      product.createdByName &&
      product.updatedByName
    ) {
      skipped++;
      continue;
    }

    const $set = {};
    if (!product.createdBy && createdBy) {
      $set.createdBy = createdBy;
      $set.createdByName = createdByName;
      $set.createdByEmail = createdByEmail;
    } else if (product.createdBy && !product.createdByName && createdByName) {
      $set.createdByName = createdByName;
      $set.createdByEmail = createdByEmail;
    }

    if (!product.updatedBy && updatedBy) {
      $set.updatedBy = updatedBy;
      $set.updatedByName = updatedByName;
      $set.updatedByEmail = updatedByEmail;
    } else if (product.updatedBy && !product.updatedByName && updatedByName) {
      $set.updatedByName = updatedByName;
      $set.updatedByEmail = updatedByEmail;
    }

    if (Object.keys($set).length === 0) {
      skipped++;
      continue;
    }

    updated++;
    if (!dryRun) {
      // timestamps:false — do not bump updatedAt while stamping authorship
      bulk.push({
        updateOne: {
          filter: { _id: product._id },
          update: { $set },
          timestamps: false,
        },
      });
      if (bulk.length >= 500) {
        await Product.bulkWrite(bulk, { ordered: false });
        bulk.length = 0;
      }
    }
  }

  if (!dryRun && bulk.length > 0) {
    await Product.bulkWrite(bulk, { ordered: false });
  }

  console.log({ scanned, updated, skipped, dryRun });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
