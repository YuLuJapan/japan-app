var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/src/lib/datastore.memory.ts
var datastore_memory_exports = {};
__export(datastore_memory_exports, {
  createMemoryStore: () => createMemoryStore
});
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
function loadPlaceholderData() {
  const dataPath = fileURLToPath(new URL("../data/placeholder-data.json", import.meta.url));
  return JSON.parse(readFileSync(dataPath, "utf-8"));
}
function createMemoryStore(initial) {
  const db = structuredClone(initial ?? loadPlaceholderData());
  const emptyCounts = () => Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  return {
    async ping() {
      if (!db.trip) throw new Error("memory store is empty");
    },
    async getTrip() {
      return db.trip ?? null;
    },
    async listSteps(tripId) {
      return db.steps.filter((s) => s.trip_id === tripId).sort((a, b) => a.position - b.position);
    },
    async getZone(zoneId) {
      return db.zones.find((z) => z.id === zoneId) ?? null;
    },
    async countPlacesByCategory(zoneId) {
      const counts = emptyCounts();
      for (const p of db.places) if (p.zone_id === zoneId) counts[p.category]++;
      return counts;
    },
    async listPlaces(zoneId, category) {
      return db.places.filter((p) => p.zone_id === zoneId && p.category === category);
    },
    async getPlace(placeId) {
      return db.places.find((p) => p.id === placeId) ?? null;
    },
    async createPlace(input) {
      const place = {
        id: randomUUID(),
        zone_id: input.zone_id,
        category: input.category,
        name: input.name,
        name_ja: input.name_ja ?? null,
        description: input.description ?? null,
        address: input.address ?? null,
        links: input.links ?? [],
        image_url: input.image_url ?? null
      };
      db.places.push(place);
      return structuredClone(place);
    },
    async updatePlace(placeId, patch) {
      const place = db.places.find((p) => p.id === placeId);
      if (!place) return null;
      if (patch.zone_id !== void 0) place.zone_id = patch.zone_id;
      if (patch.category !== void 0) place.category = patch.category;
      if (patch.name !== void 0) place.name = patch.name;
      if (patch.name_ja !== void 0) place.name_ja = patch.name_ja ?? null;
      if (patch.description !== void 0) place.description = patch.description ?? null;
      if (patch.address !== void 0) place.address = patch.address ?? null;
      if (patch.links !== void 0) place.links = patch.links ?? [];
      if (patch.image_url !== void 0) place.image_url = patch.image_url ?? null;
      return structuredClone(place);
    },
    async deletePlace(placeId) {
      const idx = db.places.findIndex((p) => p.id === placeId);
      if (idx === -1) return false;
      db.places.splice(idx, 1);
      db.tips = db.tips.filter((t) => t.place_id !== placeId);
      return true;
    },
    async listTips(parent) {
      if ("zone_id" in parent) return db.tips.filter((t) => t.zone_id === parent.zone_id);
      return db.tips.filter((t) => t.place_id === parent.place_id);
    },
    async createTip(input) {
      const tip = {
        id: randomUUID(),
        zone_id: input.zone_id ?? null,
        place_id: input.place_id ?? null,
        body: input.body
      };
      db.tips.push(tip);
      return structuredClone(tip);
    },
    async updateTip(tipId, body) {
      const tip = db.tips.find((t) => t.id === tipId);
      if (!tip) return null;
      tip.body = body;
      return structuredClone(tip);
    },
    async deleteTip(tipId) {
      const idx = db.tips.findIndex((t) => t.id === tipId);
      if (idx === -1) return false;
      db.tips.splice(idx, 1);
      return true;
    },
    async listFiles(parent) {
      if ("trip_id" in parent) return db.files.filter((f) => f.trip_id === parent.trip_id);
      if ("zone_id" in parent) return db.files.filter((f) => f.zone_id === parent.zone_id);
      return db.files.filter((f) => f.place_id === parent.place_id);
    },
    async countTripFiles(tripId) {
      return db.files.filter((f) => f.trip_id === tripId).length;
    },
    async getFile(fileId) {
      return db.files.find((f) => f.id === fileId) ?? null;
    },
    async reparentFilesToTrip(placeId, tripId) {
      for (const f of db.files) {
        if (f.place_id === placeId) {
          f.place_id = null;
          f.trip_id = tripId;
        }
      }
    },
    async getFileUrl(file) {
      const abs = path.join(process.cwd(), "public", file.storage_path);
      if (!existsSync(abs)) return "FILE_MISSING";
      return { url: `/${file.storage_path.replace(/\\/g, "/")}`, expires_in: 300 };
    }
  };
}
var init_datastore_memory = __esm({
  "server/src/lib/datastore.memory.ts"() {
    "use strict";
    init_datastore();
  }
});

// server/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY must be set to use DATA_BACKEND=supabase"
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}
var client, FILES_BUCKET;
var init_supabase = __esm({
  "server/src/lib/supabase.ts"() {
    "use strict";
    client = null;
    FILES_BUCKET = "trip-files";
  }
});

// server/src/lib/datastore.supabase.ts
var datastore_supabase_exports = {};
__export(datastore_supabase_exports, {
  createSupabaseStore: () => createSupabaseStore
});
import { randomUUID as randomUUID2 } from "node:crypto";
function createSupabaseStore() {
  const db = getSupabase();
  return {
    async ping() {
      const { error } = await db.from("trips").select("id").limit(1);
      if (error) throw new Error(`Supabase unreachable: ${error.message}`);
    },
    async getTrip() {
      const { data } = await db.from("trips").select("id,name,start_date,end_date,description").order("created_at", { ascending: true }).limit(1).maybeSingle();
      return data ?? null;
    },
    async listSteps(tripId) {
      const { data } = await db.from("journey_steps").select("id,trip_id,zone_id,position,start_date,end_date").eq("trip_id", tripId).order("position", { ascending: true });
      return data ?? [];
    },
    async getZone(zoneId) {
      const { data } = await db.from("zones").select("id,name,name_ja,summary,image_url,lat,lng").eq("id", zoneId).maybeSingle();
      return data ?? null;
    },
    async countPlacesByCategory(zoneId) {
      const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
      const { data } = await db.from("places").select("category").eq("zone_id", zoneId);
      for (const row of data ?? []) counts[row.category]++;
      return counts;
    },
    async listPlaces(zoneId, category) {
      const { data } = await db.from("places").select("id,zone_id,category,name,name_ja,description,address,links,image_url").eq("zone_id", zoneId).eq("category", category).order("created_at", { ascending: true });
      return data ?? [];
    },
    async getPlace(placeId) {
      const { data } = await db.from("places").select("id,zone_id,category,name,name_ja,description,address,links,image_url").eq("id", placeId).maybeSingle();
      return data ?? null;
    },
    async createPlace(input) {
      const row = {
        id: randomUUID2(),
        zone_id: input.zone_id,
        category: input.category,
        name: input.name,
        name_ja: input.name_ja ?? null,
        description: input.description ?? null,
        address: input.address ?? null,
        links: input.links ?? [],
        image_url: input.image_url ?? null
      };
      const { data, error } = await db.from("places").insert(row).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async updatePlace(placeId, patch) {
      const fields = {};
      if (patch.zone_id !== void 0) fields.zone_id = patch.zone_id;
      if (patch.category !== void 0) fields.category = patch.category;
      if (patch.name !== void 0) fields.name = patch.name;
      if (patch.name_ja !== void 0) fields.name_ja = patch.name_ja ?? null;
      if (patch.description !== void 0) fields.description = patch.description ?? null;
      if (patch.address !== void 0) fields.address = patch.address ?? null;
      if (patch.links !== void 0) fields.links = patch.links ?? [];
      if (patch.image_url !== void 0) fields.image_url = patch.image_url ?? null;
      const { data } = await db.from("places").update(fields).eq("id", placeId).select().maybeSingle();
      return data ?? null;
    },
    async deletePlace(placeId) {
      const { data } = await db.from("places").delete().eq("id", placeId).select("id");
      return (data?.length ?? 0) > 0;
    },
    async listTips(parent) {
      const q = db.from("tips").select("id,zone_id,place_id,body");
      const { data } = "zone_id" in parent ? await q.eq("zone_id", parent.zone_id) : await q.eq("place_id", parent.place_id);
      return data ?? [];
    },
    async createTip(input) {
      const row = {
        id: randomUUID2(),
        zone_id: input.zone_id ?? null,
        place_id: input.place_id ?? null,
        body: input.body
      };
      const { data, error } = await db.from("tips").insert(row).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateTip(tipId, body) {
      const { data } = await db.from("tips").update({ body }).eq("id", tipId).select().maybeSingle();
      return data ?? null;
    },
    async deleteTip(tipId) {
      const { data } = await db.from("tips").delete().eq("id", tipId).select("id");
      return (data?.length ?? 0) > 0;
    },
    async listFiles(parent) {
      const q = db.from("files").select("id,trip_id,zone_id,place_id,display_name,storage_path,mime_type,size_bytes");
      let res;
      if ("trip_id" in parent) res = await q.eq("trip_id", parent.trip_id);
      else if ("zone_id" in parent) res = await q.eq("zone_id", parent.zone_id);
      else res = await q.eq("place_id", parent.place_id);
      return res.data ?? [];
    },
    async countTripFiles(tripId) {
      const { count } = await db.from("files").select("id", { count: "exact", head: true }).eq("trip_id", tripId);
      return count ?? 0;
    },
    async getFile(fileId) {
      const { data } = await db.from("files").select("id,trip_id,zone_id,place_id,display_name,storage_path,mime_type,size_bytes").eq("id", fileId).maybeSingle();
      return data ?? null;
    },
    async reparentFilesToTrip(placeId, tripId) {
      await db.from("files").update({ place_id: null, trip_id: tripId }).eq("place_id", placeId);
    },
    async getFileUrl(file) {
      const { data, error } = await db.storage.from(FILES_BUCKET).createSignedUrl(file.storage_path, SIGNED_URL_TTL);
      if (error || !data?.signedUrl) return "FILE_MISSING";
      return { url: data.signedUrl, expires_in: SIGNED_URL_TTL };
    }
  };
}
var SIGNED_URL_TTL;
var init_datastore_supabase = __esm({
  "server/src/lib/datastore.supabase.ts"() {
    "use strict";
    init_datastore();
    init_supabase();
    SIGNED_URL_TTL = 300;
  }
});

// server/src/lib/datastore.ts
async function getDataStore() {
  if (store) return store;
  const backend = process.env.DATA_BACKEND ?? "memory";
  if (backend === "memory") {
    const { createMemoryStore: createMemoryStore2 } = await Promise.resolve().then(() => (init_datastore_memory(), datastore_memory_exports));
    store = createMemoryStore2();
  } else if (backend === "supabase") {
    const { createSupabaseStore: createSupabaseStore2 } = await Promise.resolve().then(() => (init_datastore_supabase(), datastore_supabase_exports));
    store = createSupabaseStore2();
  } else {
    throw new Error(`Unknown DATA_BACKEND "${backend}" (expected "memory" or "supabase")`);
  }
  return store;
}
var CATEGORIES, store;
var init_datastore = __esm({
  "server/src/lib/datastore.ts"() {
    "use strict";
    CATEGORIES = ["hotel", "attraction", "food", "shopping", "other"];
    store = null;
  }
});

// server/src/app.ts
import express from "express";

// server/src/lib/errors.ts
var ApiError = class extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  status;
  code;
  details;
};
var notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);
var validation = (details) => new ApiError(400, "VALIDATION", "Invalid request", details);
var asyncHandler = (fn) => (req, res, next) => {
  fn(req, res, next).catch(next);
};
function errorMiddleware(err, _req, res, _next) {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...err.details && { details: err.details } }
    });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
}

// server/src/lib/auth.ts
var EXEMPT_PATHS = /* @__PURE__ */ new Set(["/api/health", "/api/auth/verify"]);
function accessCode() {
  const code = process.env.TRIP_ACCESS_CODE;
  if (code && code.trim()) return code.trim();
  return "japan2026";
}
function authMiddleware(req, _res, next) {
  if (EXEMPT_PATHS.has(req.path)) return next();
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (token !== accessCode()) {
    return next(new ApiError(401, "UNAUTHORIZED", "Missing or invalid access code"));
  }
  next();
}

// server/src/routes/auth.ts
import { Router } from "express";
var authRouter = Router();
authRouter.post(
  "/auth/verify",
  asyncHandler(async (req, res) => {
    const { code } = req.body ?? {};
    if (typeof code !== "string" || code.trim() !== accessCode()) {
      throw new ApiError(401, "UNAUTHORIZED", "Wrong access code");
    }
    res.json({ ok: true });
  })
);

// server/src/routes/files.ts
import { Router as Router2 } from "express";
init_datastore();

// server/src/services/files.ts
async function listTripFiles(store2) {
  const trip = await store2.getTrip();
  if (!trip) throw notFound("Trip");
  const files = await store2.listFiles({ trip_id: trip.id });
  return {
    files: files.map(({ id, display_name, mime_type, size_bytes }) => ({
      id,
      display_name,
      mime_type,
      size_bytes
    }))
  };
}
async function getFileUrl(store2, fileId) {
  const file = await store2.getFile(fileId);
  if (!file) throw notFound("File");
  const result = await store2.getFileUrl(file);
  if (result === "FILE_MISSING") {
    throw new ApiError(404, "FILE_MISSING", "The stored file is missing or no longer available");
  }
  return result;
}

// server/src/routes/files.ts
var filesRouter = Router2();
filesRouter.get(
  "/files",
  asyncHandler(async (_req, res) => {
    res.json(await listTripFiles(await getDataStore()));
  })
);
filesRouter.get(
  "/files/:fileId/url",
  asyncHandler(async (req, res) => {
    res.json(await getFileUrl(await getDataStore(), req.params.fileId));
  })
);

// server/src/routes/health.ts
import { Router as Router3 } from "express";
init_datastore();
var healthRouter = Router3();
healthRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const store2 = await getDataStore();
    await store2.ping();
    res.json({ ok: true });
  })
);

// server/src/routes/places.ts
import { Router as Router4 } from "express";
init_datastore();

// server/src/services/places.ts
init_datastore();
async function getPlaceDetail(store2, placeId) {
  const place = await store2.getPlace(placeId);
  if (!place) throw notFound("Place");
  const [tips, files] = await Promise.all([
    store2.listTips({ place_id: placeId }),
    store2.listFiles({ place_id: placeId })
  ]);
  return {
    place,
    tips,
    files: files.map(({ id, display_name, mime_type, size_bytes }) => ({
      id,
      display_name,
      mime_type,
      size_bytes
    }))
  };
}
var isHttpUrl = (u) => /^https?:\/\/.+/.test(u);
function collectPlaceErrors(input, partial) {
  const errors = [];
  const has = (k) => input[k] !== void 0;
  if (!partial || has("name")) {
    const name = (input.name ?? "").trim();
    if (!name) errors.push("name is required");
    else if (name.length > 120) errors.push("name must be at most 120 characters");
  }
  if (!partial || has("category")) {
    if (!CATEGORIES.includes(input.category))
      errors.push(`category must be one of: ${CATEGORIES.join(", ")}`);
  }
  if (!partial && !input.zone_id) errors.push("zone_id is required");
  if (has("links") && input.links != null) {
    if (!Array.isArray(input.links)) errors.push("links must be an array");
    else {
      for (const link of input.links) {
        if (!link?.label?.trim()) errors.push("every link needs a label");
        if (!link?.url || !isHttpUrl(link.url)) errors.push("every link url must start with http(s)://");
      }
    }
  }
  if (has("description") && (input.description ?? "").length > 5e3)
    errors.push("description must be at most 5000 characters");
  if (has("image_url") && input.image_url != null && input.image_url !== "" && !isHttpUrl(input.image_url))
    errors.push("image_url must start with http(s)://");
  return errors;
}
async function createPlace(store2, input) {
  const errors = collectPlaceErrors(input, false);
  if (errors.length) throw validation(errors);
  const zone = await store2.getZone(input.zone_id);
  if (!zone) throw notFound("Zone");
  const place = await store2.createPlace({ ...input, name: input.name.trim() });
  return { place };
}
async function updatePlace(store2, placeId, patch) {
  const errors = collectPlaceErrors(patch, true);
  if (errors.length) throw validation(errors);
  if (patch.zone_id) {
    const zone = await store2.getZone(patch.zone_id);
    if (!zone) throw notFound("Zone");
  }
  const place = await store2.updatePlace(placeId, patch);
  if (!place) throw notFound("Place");
  return { place };
}
async function deletePlace(store2, placeId) {
  const place = await store2.getPlace(placeId);
  if (!place) throw notFound("Place");
  const trip = await store2.getTrip();
  if (trip) await store2.reparentFilesToTrip(placeId, trip.id);
  await store2.deletePlace(placeId);
}

// server/src/routes/places.ts
var placesRouter = Router4();
placesRouter.get(
  "/places/:placeId",
  asyncHandler(async (req, res) => {
    res.json(await getPlaceDetail(await getDataStore(), req.params.placeId));
  })
);
placesRouter.post(
  "/places",
  asyncHandler(async (req, res) => {
    res.status(201).json(await createPlace(await getDataStore(), req.body ?? {}));
  })
);
placesRouter.patch(
  "/places/:placeId",
  asyncHandler(async (req, res) => {
    res.json(await updatePlace(await getDataStore(), req.params.placeId, req.body ?? {}));
  })
);
placesRouter.delete(
  "/places/:placeId",
  asyncHandler(async (req, res) => {
    await deletePlace(await getDataStore(), req.params.placeId);
    res.status(204).end();
  })
);

// server/src/routes/tips.ts
import { Router as Router5 } from "express";
init_datastore();

// server/src/services/tips.ts
function collectTipErrors(input) {
  const errors = [];
  const body = (input.body ?? "").trim();
  if (!body) errors.push("body is required");
  else if (body.length > 1e3) errors.push("body must be at most 1000 characters");
  const parents = [input.zone_id, input.place_id].filter((v) => v != null);
  if (parents.length !== 1) errors.push("a tip must have exactly one parent: zone_id or place_id");
  return errors;
}
async function createTip(store2, input) {
  const errors = collectTipErrors(input);
  if (errors.length) throw validation(errors);
  if (input.zone_id) {
    if (!await store2.getZone(input.zone_id)) throw notFound("Zone");
  } else if (input.place_id) {
    if (!await store2.getPlace(input.place_id)) throw notFound("Place");
  }
  const tip = await store2.createTip({ ...input, body: input.body.trim() });
  return { tip };
}
async function updateTip(store2, tipId, body) {
  const trimmed = typeof body === "string" ? body.trim() : "";
  if (!trimmed) throw validation(["body is required"]);
  if (trimmed.length > 1e3) throw validation(["body must be at most 1000 characters"]);
  const tip = await store2.updateTip(tipId, trimmed);
  if (!tip) throw notFound("Tip");
  return { tip };
}
async function deleteTip(store2, tipId) {
  const ok = await store2.deleteTip(tipId);
  if (!ok) throw notFound("Tip");
}

// server/src/routes/tips.ts
var tipsRouter = Router5();
tipsRouter.post(
  "/tips",
  asyncHandler(async (req, res) => {
    res.status(201).json(await createTip(await getDataStore(), req.body ?? {}));
  })
);
tipsRouter.patch(
  "/tips/:tipId",
  asyncHandler(async (req, res) => {
    res.json(await updateTip(await getDataStore(), req.params.tipId, (req.body ?? {}).body));
  })
);
tipsRouter.delete(
  "/tips/:tipId",
  asyncHandler(async (req, res) => {
    await deleteTip(await getDataStore(), req.params.tipId);
    res.status(204).end();
  })
);

// server/src/routes/trip.ts
import { Router as Router6 } from "express";
init_datastore();

// server/src/services/trips.ts
async function getTripBundle(store2) {
  const trip = await store2.getTrip();
  if (!trip) throw notFound("Trip");
  const steps = await store2.listSteps(trip.id);
  const stepsWithZones = await Promise.all(
    steps.map(async (step) => {
      const zone = await store2.getZone(step.zone_id);
      const place_counts = await store2.countPlacesByCategory(step.zone_id);
      return {
        id: step.id,
        position: step.position,
        start_date: step.start_date,
        end_date: step.end_date,
        zone: zone ? { ...zone, place_counts } : null
      };
    })
  );
  const trip_files_count = await store2.countTripFiles(trip.id);
  return { trip, steps: stepsWithZones, trip_files_count };
}

// server/src/routes/trip.ts
var tripRouter = Router6();
tripRouter.get(
  "/trip",
  asyncHandler(async (_req, res) => {
    res.json(await getTripBundle(await getDataStore()));
  })
);

// server/src/routes/zones.ts
import { Router as Router7 } from "express";
init_datastore();

// server/src/services/zones.ts
init_datastore();
async function getZoneDetail(store2, zoneId) {
  const zone = await store2.getZone(zoneId);
  if (!zone) throw notFound("Zone");
  const [tips, files, place_counts] = await Promise.all([
    store2.listTips({ zone_id: zoneId }),
    store2.listFiles({ zone_id: zoneId }),
    store2.countPlacesByCategory(zoneId)
  ]);
  return {
    zone,
    tips,
    files: files.map(({ id, display_name, mime_type, size_bytes }) => ({
      id,
      display_name,
      mime_type,
      size_bytes
    })),
    place_counts
  };
}
async function listZonePlaces(store2, zoneId, category) {
  if (!CATEGORIES.includes(category)) {
    throw validation([`category must be one of: ${CATEGORIES.join(", ")}`]);
  }
  const zone = await store2.getZone(zoneId);
  if (!zone) throw notFound("Zone");
  const places = await store2.listPlaces(zoneId, category);
  return {
    places: places.map((p) => ({
      id: p.id,
      name: p.name,
      name_ja: p.name_ja,
      category: p.category,
      summary_line: p.description ? p.description.slice(0, 100) : "",
      image_url: p.image_url ?? null
    }))
  };
}

// server/src/routes/zones.ts
var zonesRouter = Router7();
zonesRouter.get(
  "/zones/:zoneId",
  asyncHandler(async (req, res) => {
    res.json(await getZoneDetail(await getDataStore(), req.params.zoneId));
  })
);
zonesRouter.get(
  "/zones/:zoneId/places",
  asyncHandler(async (req, res) => {
    const category = String(req.query.category ?? "");
    res.json(await listZonePlaces(await getDataStore(), req.params.zoneId, category));
  })
);

// server/src/app.ts
function createApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(authMiddleware);
  app.use("/api", healthRouter);
  app.use("/api", authRouter);
  app.use("/api", tripRouter);
  app.use("/api", zonesRouter);
  app.use("/api", placesRouter);
  app.use("/api", tipsRouter);
  app.use("/api", filesRouter);
  app.use("/api", (_req, _res, next) => next(notFound("Endpoint")));
  app.use(errorMiddleware);
  return app;
}

// server/vercel-handler.ts
var vercel_handler_default = createApp();
export {
  vercel_handler_default as default
};
