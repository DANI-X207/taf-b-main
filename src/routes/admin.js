const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { getDb, nowIso } = require("../db");
const { cleanText, cleanUrl } = require("../helpers");
const { requireAdmin } = require("../middleware");

const router = express.Router();

const COVERS_DIR = path.join(__dirname, "..", "..", "public", "uploads", "covers");
fs.mkdirSync(COVERS_DIR, { recursive: true });

const ALLOWED_MIME = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };

const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, COVERS_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME[file.mimetype] || path.extname(file.originalname).toLowerCase() || ".bin";
    cb(null, crypto.randomBytes(8).toString("hex") + ext);
  },
});
const uploadCover = multer({
  storage: coverStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) return cb(new Error("Format d'image non supporté (PNG, JPG, WEBP, GIF uniquement)."));
    cb(null, true);
  },
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "TAF1-FLEMME";
const ADMIN_PASSWORD_SUPER = process.env.ADMIN_PASSWORD_SUPER || "MMDE2007";

function safeEqual(a, b) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

const ORDER_STATUSES = ["En attente", "Confirmée", "En livraison", "Livrée", "Annulée"];

function rowToOrder(row, items = []) {
  const order = { ...row };
  order.items = items;
  const created = new Date(row.created_at + "Z");
  const deadline = new Date(created.getTime() + 5 * 60 * 1000);
  order.can_cancel = ["En attente", "Confirmée"].includes(row.status) && new Date() <= deadline;
  order.tracking_steps = ORDER_STATUSES.slice(0, -1);
  return order;
}

async function tryValidateOrder(db, orderId) {
  const order = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
  if (!order) return order;
  if (order.admin_confirmed && order.client_confirmed && order.status !== "Validée") {
    const now = nowIso();
    await db.run("UPDATE orders SET status = 'Validée', validated_at = ?, updated_at = ? WHERE id = ?", now, now, orderId);
    return await db.get("SELECT * FROM orders WHERE id = ?", orderId);
  }
  return order;
}

const { getCurrentAdminRole } = require("../middleware");

router.get("/api/admin/status", async (req, res) => {
  const role = await getCurrentAdminRole(req);
  const isAuthenticated = role !== null;
  const viaPhone = isAuthenticated && !req.session.admin_authenticated;
  res.json({
    authenticated: isAuthenticated,
    role: role,
    is_super: role === "super",
    via_phone: viaPhone,
  });
});

router.post("/api/admin/login", (req, res) => {
  const data = req.body || {};
  const password = String(data.password || "");
  if (safeEqual(password, ADMIN_PASSWORD_SUPER)) {
    req.session.admin_authenticated = true;
    req.session.admin_role = "super";
    return res.json({ success: true, role: "super" });
  }
  if (safeEqual(password, ADMIN_PASSWORD)) {
    req.session.admin_authenticated = true;
    req.session.admin_role = "normal";
    return res.json({ success: true, role: "normal" });
  }
  return res.status(401).json({ error: "Mot de passe administrateur incorrect." });
});

router.post("/api/admin/logout", (req, res) => {
  req.session.admin_authenticated = false;
  req.session.admin_role = null;
  res.json({ success: true });
});

router.get("/api/admin/users", requireAdmin(), async (req, res) => {
  try {
    const db = await getDb();
    const users = await db.all(
      "SELECT id, name, email, created_at, last_login_at, is_active FROM users ORDER BY id DESC"
    );
    const withDetails = [];
    for (const u of users) {
      const orderRow = await db.get("SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as total_spent FROM orders WHERE user_id = ?", u.id);
      withDetails.push({
        ...u,
        is_active: u.is_active === undefined || u.is_active === null ? 1 : u.is_active,
        order_count: orderRow ? orderRow.cnt : 0,
        total_spent: orderRow ? orderRow.total_spent : 0,
      });
    }
    res.json(withDetails);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/admin/users/:id/toggle-status", requireAdmin(), async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get("SELECT id, is_active FROM users WHERE id = ?", parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé." });
    const newActive = user.is_active ? 0 : 1;
    await db.run("UPDATE users SET is_active = ? WHERE id = ?", newActive, user.id);
    res.json({ success: true, is_active: newActive });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/admin/users/:id", requireAdmin(), async (req, res) => {
  try {
    const db = await getDb();
    await db.run("DELETE FROM users WHERE id = ?", parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/admin/orders", requireAdmin(), async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all("SELECT * FROM orders ORDER BY id DESC");
    const orders = [];
    for (const row of rows) {
      const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", row.id);
      orders.push(rowToOrder(row, items));
    }
    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const ALLOWED_TRANSITIONS = {
  "En attente": ["Confirmée", "Annulée"],
  "Confirmée": ["En livraison", "Annulée"],
  "En livraison": ["Livrée"],
  "Livrée": [],
  "Validée": [],
  "Reçue": [],
  "Annulée": [],
};

router.put("/api/admin/orders/:id/status", requireAdmin(), async (req, res) => {
  try {
    const data = req.body || {};
    const status = cleanText(data.status, 40, true);
    if (!ORDER_STATUSES.includes(status))
      return res.status(400).json({ error: "Statut invalide." });
    const db = await getDb();
    const orderId = parseInt(req.params.id);
    const current = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    if (!current) return res.status(404).json({ error: "Commande non trouvée." });
    if (current.status === status) return res.status(400).json({ error: "Le statut est déjà « " + status + " »." });
    const allowed = ALLOWED_TRANSITIONS[current.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Transition interdite : « " + current.status + " » → « " + status + " ». Une commande confirmée ne peut pas revenir en attente, et une commande en livraison ne peut pas être remise en confirmée." });
    }
    const now = nowIso();
    const adminConfirmed = (status === "Confirmée" || status === "En livraison" || status === "Livrée") ? 1 : undefined;
    if (adminConfirmed !== undefined) {
      await db.run("UPDATE orders SET status = ?, admin_confirmed = ?, updated_at = ? WHERE id = ?", status, adminConfirmed, now, orderId);
    } else {
      await db.run("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", status, now, orderId);
    }

    const updatedOrder = await tryValidateOrder(db, orderId);
    const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", orderId);
    res.json(rowToOrder(updatedOrder, items));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/admin/orders/:id/status", requireAdmin(), (req, res, next) => {
  req.method = "PUT";
  next();
});

router.get("/api/admin/ads", requireAdmin(), async (req, res) => {
  try {
    const db = await getDb();
    const ads = await db.all("SELECT * FROM ads ORDER BY id DESC");
    res.json(ads);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/admin/ads", requireAdmin(), async (req, res) => {
  const data = req.body || {};
  try {
    const title = cleanText(data.title, 160, true);
    const message = cleanText(data.message, 500, true);
    const link = cleanUrl(data.link, 500);
    const db = await getDb();
    const result = await db.run("INSERT INTO ads (title, message, link, active, created_at) VALUES (?,?,?,?,?)", title, message, link, data.active !== false ? 1 : 0, nowIso());
    const ad = await db.get("SELECT * FROM ads WHERE id = ?", result.lastID);
    return res.status(201).json(ad);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

router.post("/api/admin/upload-cover", requireAdmin(), (req, res) => {
  uploadCover.single("file")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE"
        ? "Image trop volumineuse (max 5 Mo)."
        : (err.message || "Téléversement impossible.");
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu." });
    return res.json({ success: true, url: "/uploads/covers/" + req.file.filename });
  });
});

router.delete("/api/admin/ads/:id", requireAdmin(), async (req, res) => {
  try {
    const db = await getDb();
    await db.run("DELETE FROM ads WHERE id = ?", parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/admin/user-modifications", requireAdmin(), async (req, res) => {
  try {
    const db = await getDb();
    const mods = await db.all(`
      SELECT m.*, u.name as user_name, u.email as user_email
      FROM user_modifications m
      JOIN users u ON m.user_id = u.id
      WHERE m.created_at >= datetime('now', '-1 day')
      ORDER BY m.id DESC
    `);
    res.json(mods);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/admin/user-modifications/:id/read", requireAdmin(), async (req, res) => {
  try {
    const db = await getDb();
    await db.run("UPDATE user_modifications SET is_read = 1 WHERE id = ?", parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
