const express = require("express");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const { getDb, nowIso } = require("../db");
const { cleanText, cleanInt, cleanEmail, cleanPhone, rowToBook } = require("../helpers");
const { requireUser, getCurrentUser, isAuthenticated, getCurrentAdminRole, getCurrentUserAdminEntry } = require("../middleware");

const router = express.Router();

const CANCEL_WINDOW_MINUTES = 5;
const ORDER_STATUSES = ["En attente", "Confirmée", "En livraison", "Livrée", "Reçue", "Annulée"];
const ALLOWED_DELIVERY_ZONES = ["Potopoto la gare", "Total vers Saint Exupérie", "Présidence", "OSH", "CHU"];

function rowToOrder(row, items = []) {
  const order = { ...row };
  order.items = items;
  const created = new Date(row.created_at + "Z");
  const deadline = new Date(created.getTime() + CANCEL_WINDOW_MINUTES * 60 * 1000);
  order.can_cancel = ["En attente", "Confirmée"].includes(row.status) && new Date() <= deadline;
  order.tracking_steps = ORDER_STATUSES.slice(0, -1);
  return order;
}

async function userCanAccessOrder(req, order) {
  const adminRole = await getCurrentAdminRole(req);
  if (adminRole) return true;
  const user = await getCurrentUser(req);
  const token = req.query.token || req.body.token;
  if (token && order.tracking_token && Buffer.from(token).length === Buffer.from(order.tracking_token).length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(order.tracking_token))) return true;
  return !!(user && order.user_id && parseInt(order.user_id) === parseInt(user.id));
}

function generateReceiptPdf(order, items, res) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="recu-commande-${order.id}.pdf"`);
  doc.pipe(res);
  doc.fontSize(24).font("Helvetica-Bold").text("Librairie Magma", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(16).font("Helvetica-Bold").text(`Reçu de commande #${order.id}`, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(11).font("Helvetica").text(`Statut : ${order.status}`);
  doc.text(`Date : ${order.created_at}`);
  doc.moveDown(0.5);
  doc.fontSize(13).font("Helvetica-Bold").text("Client");
  doc.fontSize(11).font("Helvetica");
  doc.text(order.customer_name);
  doc.text(order.customer_email);
  doc.text(order.customer_phone);
  doc.text(`Livraison : ${order.delivery_zone} — ${order.delivery_address}`);
  doc.moveDown(0.7);
  const tableTop = doc.y;
  const colWidths = [200, 130, 40, 80, 90];
  const headers = ["Livre", "Auteur", "Qté", "Prix", "Sous-total"];
  doc.font("Helvetica-Bold").fontSize(10);
  let x = 50;
  headers.forEach((h, i) => { doc.text(h, x, tableTop, { width: colWidths[i], align: "left" }); x += colWidths[i]; });
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(10);
  items.forEach((item) => {
    const y = doc.y;
    x = 50;
    [item.titre, item.auteur, String(item.qty), `${item.prix} FCFA`, `${item.prix * item.qty} FCFA`]
      .forEach((val, i) => { doc.text(val, x, y, { width: colWidths[i], align: "left" }); x += colWidths[i]; });
    doc.moveDown(0.2);
  });
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(12).text(`Total : ${order.total} FCFA`, { align: "right" });
  doc.moveDown(0.5);
  doc.font("Helvetica-Oblique").fontSize(9).text("Pour toute demande d'annulation, contactez l'administration via votre espace Mes Commandes.");
  doc.end();
}

router.get("/api/delivery-zones", requireUser(), (req, res) => {
  res.json(ALLOWED_DELIVERY_ZONES);
});

router.post("/api/orders", requireUser(), async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.status(400).json({ error: "Votre panier est vide." });
  const data = req.body || {};
  const user = await getCurrentUser(req);
  try {
    const customer_name = cleanText(data.customer_name || (user || {}).name, 140, true);
    const customer_email = cleanEmail(data.customer_email || (user || {}).email);
    const customer_phone = cleanPhone(data.customer_phone || (user || {}).phone);
    const delivery_zone = cleanText(data.delivery_zone, 120, true);
    const delivery_address = cleanText(data.delivery_address || data.delivery_zone, 260, true);
    if (!ALLOWED_DELIVERY_ZONES.includes(delivery_zone))
      return res.status(400).json({ error: "Livraison impossible : cette adresse est hors zone. Zones autorisées : Potopoto la gare, Total vers Saint Exupérie, Présidence, OSH, CHU." });

    const db = await getDb();
    const validItems = [];
    let total = 0;
    for (const item of cart) {
      const row = await db.get("SELECT * FROM books WHERE id = ?", item.id);
      if (!row) return res.status(400).json({ error: `Le livre ${item.titre} n'est plus disponible.` });
      const book = rowToBook(row);
      const qty = Math.min(cleanInt(item.qty, 1, 1), book.stock);
      if (qty <= 0) return res.status(400).json({ error: `Le livre ${book.titre} est en rupture de stock.` });
      validItems.push({ book_id: book.id, titre: book.titre, auteur: book.auteur, prix: book.prix, qty, image: book.image });
      total += book.prix * qty;
    }

    const created_at = nowIso();
    const tracking_token = crypto.randomBytes(18).toString("base64url");
    const orderResult = await db.run(
      "INSERT INTO orders (user_id, customer_name, customer_email, customer_phone, delivery_zone, delivery_address, total, status, email_status, tracking_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      (user || {}).id || null, customer_name, customer_email, customer_phone, delivery_zone, delivery_address, total, "En attente", "pending", tracking_token, created_at, created_at
    );
    const orderId = orderResult.lastID;

    if (user && !(user.phone || "").trim() && customer_phone) {
      await db.run("UPDATE users SET phone = ? WHERE id = ?", customer_phone, user.id);
    }

    for (const item of validItems) {
      await db.run(
        "INSERT INTO order_items (order_id, book_id, titre, auteur, prix, qty, image) VALUES (?,?,?,?,?,?,?)",
        orderId, item.book_id, item.titre, item.auteur, item.prix, item.qty, item.image
      );
      await db.run("UPDATE books SET stock = MAX(stock - ?, 0), sales = sales + ? WHERE id = ?", item.qty, item.qty, item.book_id);
    }
    await db.run("UPDATE orders SET email_status = 'not_configured' WHERE id = ?", orderId);
    const order = await db.get("SELECT * FROM orders WHERE id = ?", orderId);

    req.session.cart = [];
    const deadline = new Date(new Date(created_at + "Z").getTime() + CANCEL_WINDOW_MINUTES * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "");
    return res.status(201).json({ success: true, order, receipt_url: `/api/orders/${orderId}/receipt.pdf`, tracking_url: `/api/orders/${orderId}?token=${tracking_token}`, cancel_until: deadline });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

router.get("/api/orders/:id", async (req, res) => {
  try {
    const db = await getDb();
    const order = await db.get("SELECT * FROM orders WHERE id = ?", parseInt(req.params.id));
    if (!order) return res.status(404).json({ error: "Commande non trouvée" });
    if (!(await userCanAccessOrder(req, order))) return res.status(403).json({ error: "Accès à cette commande refusé." });
    const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", parseInt(req.params.id));
    res.json(rowToOrder(order, items));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/orders/:id/cancel", requireUser(), async (req, res) => {
  try {
    const db = await getDb();
    const orderId = parseInt(req.params.id);
    const order = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    if (!order) return res.status(404).json({ error: "Commande non trouvée" });
    if (!(await userCanAccessOrder(req, order))) return res.status(403).json({ error: "Accès à cette commande refusé." });
    
    // Only admins can directly cancel orders now
    const isAdmin = req.session.admin_authenticated || await getCurrentUserAdminEntry(req);
    if (!isAdmin) {
      return res.status(400).json({ error: "L'annulation directe n'est pas autorisée. Veuillez faire une demande d'annulation." });
    }
    
    if (order.status === "Annulée") return res.status(400).json({ error: "Cette commande est déjà annulée." });
    const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", orderId);
    for (const item of items) {
      if (item.book_id) await db.run("UPDATE books SET stock = stock + ? WHERE id = ?", item.qty, item.book_id);
    }
    const n = nowIso();
    await db.run("UPDATE orders SET status = 'Annulée', cancelled_at = ?, updated_at = ? WHERE id = ?", n, n, orderId);
    res.json({ success: true, status: "Annulée" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/orders/:id/request-cancel", requireUser(), async (req, res) => {
  try {
    const db = await getDb();
    const orderId = parseInt(req.params.id);
    const order = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    if (!order) return res.status(404).json({ error: "Commande non trouvée" });
    if (!(await userCanAccessOrder(req, order))) return res.status(403).json({ error: "Accès à cette commande refusé." });
    if (!["En attente", "Confirmée"].includes(order.status)) {
      return res.status(400).json({ error: "Cette commande ne peut plus être annulée car elle est déjà en livraison, livrée ou terminée." });
    }
    if (order.cancel_requested) {
      return res.status(400).json({ error: "Une demande d'annulation est déjà en cours pour cette commande." });
    }
    const reason = cleanText((req.body || {}).reason || "Non précisée", 300, true);
    const now = nowIso();
    await db.run("UPDATE orders SET cancel_requested = 1, cancel_reason = ?, updated_at = ? WHERE id = ?", reason, now, orderId);

    res.json({ success: true, message: "Demande d'annulation envoyée à l'administrateur." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/orders/:id/receipt.pdf", async (req, res) => {
  try {
    const db = await getDb();
    const order = await db.get("SELECT * FROM orders WHERE id = ?", parseInt(req.params.id));
    if (!order) return res.status(404).json({ error: "Commande non trouvée" });
    if (!(await userCanAccessOrder(req, order))) return res.status(403).json({ error: "Accès à cette commande refusé." });
    
    // The user can only download the receipt if both (admin and client) validate the order as delivered/received
    const isBothValidated = order.status === "Validée" || (order.admin_confirmed && order.client_confirmed);
    if (!isBothValidated) {
      return res.status(403).json({ error: "Le reçu sera téléchargeable dès que la livraison sera confirmée par vous et l'administrateur." });
    }
    
    const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", parseInt(req.params.id));
    generateReceiptPdf(order, items, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/orders/:id/confirm-reception", requireUser(), async (req, res) => {
  try {
    const db = await getDb();
    const orderId = parseInt(req.params.id);
    const order = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    if (!order) return res.status(404).json({ error: "Commande non trouvée." });
    if (!(await userCanAccessOrder(req, order))) return res.status(403).json({ error: "Accès à cette commande refusé." });
    if (order.client_confirmed) return res.status(400).json({ error: "Réception déjà confirmée." });
    if (!["En livraison", "Livrée"].includes(order.status)) {
      return res.status(400).json({ error: "La commande doit être en livraison ou livrée pour confirmer la réception." });
    }
    const now = nowIso();
    await db.run("UPDATE orders SET client_confirmed = 1, updated_at = ? WHERE id = ?", now, orderId);
    const updated = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    if (updated.admin_confirmed && updated.client_confirmed && updated.status !== "Validée") {
      await db.run("UPDATE orders SET status = 'Validée', validated_at = ?, updated_at = ? WHERE id = ?", now, now, orderId);
    }
    const final = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", orderId);
    res.json(rowToOrder(final, items));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/orders/:id/mark-received", requireUser(), async (req, res) => {
  try {
    const db = await getDb();
    const orderId = parseInt(req.params.id);
    const order = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    if (!order) return res.status(404).json({ error: "Commande non trouvée." });
    if (!(await userCanAccessOrder(req, order))) return res.status(403).json({ error: "Accès à cette commande refusé." });
    if (order.status === "Annulée") return res.status(400).json({ error: "Cette commande a été annulée." });
    if (order.status === "Reçue") return res.status(400).json({ error: "Réception déjà confirmée." });
    if (!["En livraison", "Livrée"].includes(order.status)) {
      return res.status(400).json({ error: "La commande doit être en livraison ou livrée pour valider la réception." });
    }
    const now = nowIso();
    await db.run("UPDATE orders SET status = 'Reçue', client_received = 1, client_confirmed = 1, received_at = ?, updated_at = ? WHERE id = ?", now, now, orderId);
    const updated = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", orderId);
    res.json(rowToOrder(updated, items));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/orders/:id/report-not-received", requireUser(), async (req, res) => {
  try {
    const db = await getDb();
    const orderId = parseInt(req.params.id);
    const order = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    if (!order) return res.status(404).json({ error: "Commande non trouvée." });
    if (!(await userCanAccessOrder(req, order))) return res.status(403).json({ error: "Accès à cette commande refusé." });
    if (order.status === "Annulée") return res.status(400).json({ error: "Cette commande a été annulée." });
    if (order.status === "Reçue") return res.status(400).json({ error: "Cette commande a déjà été marquée reçue." });
    const reason = cleanText((req.body || {}).reason || "Non précisé", 500, true);
    const now = nowIso();
    await db.run("UPDATE orders SET not_received_reported_at = ?, not_received_reason = ?, updated_at = ? WHERE id = ?", now, reason, now, orderId);
    const updated = await db.get("SELECT * FROM orders WHERE id = ?", orderId);
    const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", orderId);
    res.json(rowToOrder(updated, items));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/my-orders", requireUser(), async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    const db = await getDb();
    const orders = await db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", user.id);
    const result = [];
    for (const row of orders) {
      const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", row.id);
      result.push(rowToOrder(row, items));
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, ORDER_STATUSES, rowToOrder };

