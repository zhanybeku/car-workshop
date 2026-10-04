import { label } from "../lib/utils.js";

export default function (srv) {
  // Stops if CAP's checks found errors. Must stay first and synchronous.
  srv.before("*", (req) => {
    if (["CREATE", "UPDATE"].includes(req.event))
      assertNoNullDefaults(req, req.target, req.data);
    if (req.errors) req.reject();
  });

  // Friendly error for duplicate @assert.unique values
  srv.before(["CREATE", "UPDATE"], async (req) => {
    const { elements } = req.target;
    for (const [anno, refs] of Object.entries(req.target)) {
      if (!anno.startsWith("@assert.unique.")) continue;
      const fields = refs.map((ref) => ref["="]);

      if (!fields.some((f) => f in req.data)) continue;
      if (fields.some((f) => elements[f]["@readonly"])) continue;

      const missing = fields.filter((f) => !(f in req.data));
      const stored =
        missing.length && req.event === "UPDATE"
          ? await SELECT.one.from(req.target, req.data.ID).columns(missing)
          : {};
      const values = Object.fromEntries(
        fields.map((f) => [f, f in req.data ? req.data[f] : stored?.[f]]),
      );
      if (Object.values(values).some((v) => v == null)) continue;

      const duplicate = await SELECT.one
        .from(req.target)
        .columns("ID")
        .where({ ...values, ID: { "!=": req.data.ID } });
      if (duplicate) {
        const fieldNames = fields
          .map((f) => elements[f]["@title"] ?? f)
          .join(" + ");
        req.reject(409, "ALREADY_IN_USE", fields[0], [
          fieldNames,
          Object.values(values).join(" + "),
        ]);
      }
    }
  });

  // Which entities point to which, e.g. Customers → [Vehicles.owner]
  const referencesTo = new Map();
  for (const entity of Object.values(srv.entities)) {
    for (const assoc of Object.values(entity.associations ?? {})) {
      if (assoc.on || !assoc.is2one) continue;
      const target = assoc._target;
      if (
        Object.values(target.compositions ?? {}).some(
          (c) => c._target === entity,
        )
      )
        continue;
      if (!referencesTo.has(target)) referencesTo.set(target, []);
      referencesTo.get(target).push({ entity, foreignKeys: assoc.keys });
    }
  }

  // Blocks deleting records that are still in use
  srv.before("DELETE", async (req) => {
    const usedIn = [];
    for (const { entity, foreignKeys } of referencesTo.get(req.target) ?? []) {
      const where = Object.fromEntries(
        foreignKeys.map((k) => [k.$generatedFieldName, req.data[k.ref[0]]]),
      );
      const { count } = await SELECT.one
        .from(entity)
        .columns("count(1) as count")
        .where(where);
      if (count) usedIn.push(`${label(entity)} (${count})`);
    }

    if (usedIn.length) {
      const key = req.target.elements.isActive
        ? "STILL_IN_USE_DEACTIVATE"
        : "STILL_IN_USE";
      req.reject(409, key, [usedIn.join(", ")]);
    }
  });
}

// Fields with a default can't be set to null
function assertNoNullDefaults(req, entity, data) {
  for (const row of Array.isArray(data) ? data : [data]) {
    for (const [name, value] of Object.entries(row ?? {})) {
      const element = entity.elements[name];
      if (
        value === null &&
        element?.default !== undefined &&
        !element["@readonly"]
      ) {
        req.error(400, "ASSERT_MANDATORY", name);
      } else if (element?.isComposition) {
        assertNoNullDefaults(req, element._target, value);
      }
    }
  }
}

// Trims strings and uppercases @uppercase fields
export function normalize(entity, data) {
  for (const row of Array.isArray(data) ? data : [data]) {
    for (const [name, value] of Object.entries(row ?? {})) {
      const element = entity.elements[name];
      if (typeof value === "string" && element?.type === "cds.String") {
        row[name] = element["@uppercase"]
          ? value.trim().toUpperCase()
          : value.trim();
      } else if (element?.isComposition) {
        normalize(element._target, value);
      }
    }
  }
}
