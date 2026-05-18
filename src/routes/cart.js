const express = require("express");
const { getDb } = require("../db");
const { cleanInt, rowToBook } = require("../helpers");
const { requireUser } = require("../middleware");

const router = express.Router();

router.get("/api/cart", requireUser(), (req, res) => {
  res.json(req.session.cart || []);
});

router.post("/api/cart/add", requireUser(), async (req, res) => {
  try {
    const data = req.body || {};
    const bookId = cleanInt(data.id, 1);
    const qty = cleanInt(data.qty, 1, 1);
    const db = await getDb();
    const row = await db.get("SELECT * FROM books WHERE id = ?", bookId);
    if (!row) return res.status(404).json({ error: "Livre non trouvé" });
    const book = rowToBook(row);
    if (book.stock <= 0) return res.status(400).json({ error: "Livre indisponible" });
    const cart = req.session.cart || [];
    const existing = cart.find((i) => i.id === bookId);
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, book.stock);
    } else {
      cart.push({ id: bookId, titre: book.titre, auteur: book.auteur, prix: book.prix, image: book.image, qty: Math.min(qty, book.stock) });
    }
    req.session.cart = cart;
    res.json({ success: true, cart });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/cart/remove/:id", requireUser(), (req, res) => {
  const bookId = parseInt(req.params.id);
  req.session.cart = (req.session.cart || []).filter((i) => i.id !== bookId);
  res.json({ success: true, cart: req.session.cart });
});

router.delete("/api/cart/clear", requireUser(), (req, res) => {
  req.session.cart = [];
  res.json({ success: true });
});

module.exports = router;
