/**
 * Denormalized listing authorship stamps (who entered / who last updated).
 * Uses the authenticated IMS actor on req.user (not view-as overlays — view-as
 * blocks mutations, so create/update always see the real actor).
 */

const actorId = (user) => {
  if (!user) return null;
  return user.id || user._id || null;
};

/** Fields to set on create (entered + last updated = same actor). */
const createdAuthorshipFields = (user) => {
  const id = actorId(user);
  if (!id) return {};
  const name = user.name || "Unknown";
  const email = user.email || "";
  return {
    createdBy: id,
    createdByName: name,
    createdByEmail: email,
    updatedBy: id,
    updatedByName: name,
    updatedByEmail: email,
  };
};

/** Fields to set on any subsequent mutation. */
const updatedAuthorshipFields = (user) => {
  const id = actorId(user);
  if (!id) return {};
  return {
    updatedBy: id,
    updatedByName: user.name || "Unknown",
    updatedByEmail: user.email || "",
  };
};

module.exports = {
  createdAuthorshipFields,
  updatedAuthorshipFields,
};
