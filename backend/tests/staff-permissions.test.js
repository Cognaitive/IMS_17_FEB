const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { app, request, startDb, stopDb, clearDb, createUser, authHeader } = require("./setup");
const { Product } = require("../models/Product");

describe("IMS product permissions", () => {
  let owner, tissot, seiko;

  before(startDb);
  after(stopDb);
  beforeEach(async () => {
    await clearDb();
    owner = await createUser({ role: "Owner" });
    tissot = await Product.create({ brand: "Tissot", sku: "T-100", title: "Tissot PRX", price: 30000, inventory: 3 });
    seiko = await Product.create({ brand: "Seiko", sku: "S-200", title: "Seiko 5", price: 15000, inventory: 2 });
  });

  const staff = (fields = {}) => createUser({ role: "staff", allowedBrands: ["Tissot"], ...fields });

  it("keeps website customers out of the IMS API", async () => {
    const customer = await createUser();
    const res = await request(app).get("/api/products").set(authHeader(customer));
    assert.equal(res.status, 403);
  });

  it("blocks staff from editing, viewing or deleting another brand", async () => {
    const member = await staff();
    const h = authHeader(member);

    assert.equal((await request(app).patch(`/api/products/${seiko._id}`).set(h).send({ price: 1 })).status, 403);
    assert.equal((await request(app).get(`/api/products/${seiko._id}`).set(h)).status, 403);
    assert.equal((await request(app).delete(`/api/products/${seiko._id}`).set(h)).status, 403);
    assert.equal((await Product.findById(seiko._id)).price, 15000);
  });

  it("blocks staff from moving a product into a brand they don't have", async () => {
    const member = await staff();
    const res = await request(app).put(`/api/products/${tissot._id}`).set(authHeader(member)).send({ brand: "Seiko" });
    assert.equal(res.status, 403);
  });

  it("blocks staff from creating a product for another brand", async () => {
    const member = await staff();
    const res = await request(app).post("/api/products").set(authHeader(member)).send({ brand: "Seiko", sku: "S-999", title: "x" });
    assert.equal(res.status, 403);
    assert.equal(await Product.countDocuments({ sku: "S-999" }), 0);
  });

  it("rejects a bulk delete that includes another brand, deleting nothing", async () => {
    const member = await staff();
    const res = await request(app)
      .post("/api/products/bulk/delete")
      .set(authHeader(member))
      .send({ ids: [tissot._id, seiko._id] });
    assert.equal(res.status, 403);
    assert.equal(await Product.countDocuments(), 2);
  });

  it("lets staff edit their own brand", async () => {
    const member = await staff();
    const res = await request(app).patch(`/api/products/${tissot._id}`).set(authHeader(member)).send({ price: 31000 });
    assert.equal(res.status, 200);
    assert.equal((await Product.findById(tissot._id)).price, 31000);
  });

  it("blocks view-only staff from any edit", async () => {
    const member = await staff({ canEditProducts: false });
    const res = await request(app).patch(`/api/products/${tissot._id}`).set(authHeader(member)).send({ price: 31000 });
    assert.equal(res.status, 403);
  });

  it("lets SEO-only staff save SEO while the unchanged form fields come along", async () => {
    const member = await staff({ canEditBasicInfo: false });
    const h = authHeader(member);

    const seoSave = await request(app)
      .patch(`/api/products/${tissot._id}`)
      .set(h)
      .send({ title: "Tissot PRX", price: 30000, inventory: 3, samePriceChecked: false, seoTitle: "Tissot PRX 40mm | Samay Watch" });
    assert.equal(seoSave.status, 200);

    const priceChange = await request(app).patch(`/api/products/${tissot._id}`).set(h).send({ price: 1 });
    assert.equal(priceChange.status, 403);
  });

  it("blocks staff with SEO switched off from changing SEO fields", async () => {
    const member = await staff({ canEditSeo: false });
    const res = await request(app).patch(`/api/products/${tissot._id}`).set(authHeader(member)).send({ seoTitle: "x" });
    assert.equal(res.status, 403);
  });

  it("saves SEO fields from the IMS edit form and returns them when reopened", async () => {
    const h = authHeader(owner);
    const seo = {
      seoTitle: "Tissot PRX Powermatic 80 | Samay Watch",
      seoDescription: "Buy the Tissot PRX at Samay Watch.",
      seoKeywords: "tissot prx, tissot india",
      seoImage: "https://cdn.example.com/prx.webp",
    };

    const save = await request(app).patch(`/api/products/${tissot._id}`).set(h).send(seo);
    assert.equal(save.status, 200);

    const reopened = await request(app).get(`/api/products/${tissot._id}`).set(h);
    for (const [key, value] of Object.entries(seo)) assert.equal(reopened.body.data[key], value);
  });
});
