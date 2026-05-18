const express = require("express");
const { getDb, nowIso } = require("../db");
const { cleanText, cleanInt } = require("../helpers");
const { requireUser, getCurrentUser } = require("../middleware");

const router = express.Router();

async function handlePostReview(req, res, bookIdFromParam) {
  const data = req.body || {};
  try {
    const bookId = bookIdFromParam ? parseInt(bookIdFromParam, 10) : parseInt(data.book_id, 10);
    const userId = data.user_id ? cleanInt(data.user_id, 1) : null;
    const rating = parseInt(data.rating, 10);
    if (!Number.isInteger(bookId) || bookId < 1) throw new Error("Livre invalide.");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("La note doit être comprise entre 1 et 5.");
    const user = await getCurrentUser(req);
    if (userId && user && userId !== user.id && !req.session.admin_authenticated) throw new Error("Utilisateur non autorisé pour cet avis.");
    const customerName = cleanText(data.customer_name || (user || {}).name || (req.session.admin_authenticated ? "Administrateur" : ""), 120, true);
    const comment = cleanText(data.comment, 800, true);
    const db = await getDb();
    if (!(await db.get("SELECT id FROM books WHERE id = ?", bookId))) {
      return res.status(404).json({ error: "Livre non trouvé" });
    }
    const finalUserId = userId || (user || {}).id || null;
    if (finalUserId && !(await db.get("SELECT id FROM users WHERE id = ?", finalUserId))) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }
    const result = await db.run(
      "INSERT INTO reviews (book_id, user_id, customer_name, rating, comment, created_at) VALUES (?,?,?,?,?,?)",
      bookId, finalUserId, customerName, rating, comment, nowIso()
    );
    const review = await db.get("SELECT * FROM reviews WHERE id = ?", result.lastID);
    return res.status(201).json({ success: true, message: "Avis enregistré", review });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message || "Impossible d'enregistrer l'avis." });
  }
}

router.post("/api/reviews", requireUser(), (req, res) => handlePostReview(req, res));
router.post("/api/books/:id/reviews", requireUser(), (req, res) => handlePostReview(req, res, req.params.id));

module.exports = router;
