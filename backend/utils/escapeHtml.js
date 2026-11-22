const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);

// Escapes every string field of a flat object (e.g. a shipping address); works on Mongoose subdocs too.
const escapeFields = (obj) => {
  const plain = typeof obj?.toObject === "function" ? obj.toObject() : obj || {};
  return Object.fromEntries(
    Object.entries(plain).map(([key, value]) => [key, typeof value === "string" ? escapeHtml(value) : value])
  );
};

module.exports = { escapeHtml, escapeFields };
