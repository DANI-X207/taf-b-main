const express = require("express");
const { getDb, nowIso } = require("../db");
const { cleanText, cleanInt, cleanUrl, rowToBook } = require("../helpers");
const { requireUser, requireAdmin } = require("../middleware");

const router = express.Router();

router.get("/api/books", requireUser(), async (req, res) => {
  try {
    const genre = cleanText(req.query.genre || "", 80);
    const search = cleanText(req.query.search || "", 120);
    const db = await getDb();
    let query = "SELECT * FROM books WHERE 1=1";
    const params = [];
    if (genre) { query += " AND genre = ?"; params.push(genre); }
    if (search) {
      query += " AND (titre LIKE ? OR auteur LIKE ? OR genre LIKE ? OR description LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    query += " ORDER BY featured DESC, id DESC";
    const books = (await db.all(query, ...params)).map(rowToBook);
    res.json(books);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/books/featured", requireUser(), async (req, res) => {
  try {
    const db = await getDb();
    const books = (await db.all("SELECT * FROM books WHERE featured = 1 ORDER BY id DESC")).map(rowToBook);
    res.json(books);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/books/:id", requireUser(), async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get("SELECT * FROM books WHERE id = ?", parseInt(req.params.id));
    if (!row) return res.status(404).json({ error: "Livre non trouvé" });
    res.json(rowToBook(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/books", requireAdmin(), async (req, res) => {
  const data = req.body || {};
  try {
    const titre = cleanText(data.titre, 160, true);
    const auteur = cleanText(data.auteur, 160, true);
    const genre = cleanText(data.genre, 80, true);
    const prix = cleanInt(data.prix, 1);
    if (prix <= 0) throw new Error("Prix invalide");
    const image = cleanUrl(data.image, 700);
    const db = await getDb();
    const result = await db.run(
      "INSERT INTO books (titre, auteur, genre, prix, description, image, stock, featured, infos, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      titre, auteur, genre, prix, cleanText(data.description, 1200), image, cleanInt(data.stock, 0, 10), data.featured ? 1 : 0, cleanText(data.infos, 1000), nowIso()
    );
    const book = rowToBook(await db.get("SELECT * FROM books WHERE id = ?", result.lastID));
    return res.status(201).json(book);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

router.put("/api/books/:id", requireAdmin(), async (req, res) => {
  const data = req.body || {};
  try {
    const titre = cleanText(data.titre, 160, true);
    const auteur = cleanText(data.auteur, 160, true);
    const genre = cleanText(data.genre, 80, true);
    const prix = cleanInt(data.prix, 1);
    if (prix <= 0) throw new Error("Prix invalide");
    const image = cleanUrl(data.image, 700);
    const db = await getDb();
    const result = await db.run(
      "UPDATE books SET titre=?, auteur=?, genre=?, prix=?, description=?, image=?, stock=?, featured=?, infos=? WHERE id=?",
      titre, auteur, genre, prix, cleanText(data.description, 1200), image, cleanInt(data.stock, 0, 10), data.featured ? 1 : 0, cleanText(data.infos, 1000), parseInt(req.params.id)
    );
    if (result.changes === 0) return res.status(404).json({ error: "Livre non trouvé" });
    const book = rowToBook(await db.get("SELECT * FROM books WHERE id = ?", parseInt(req.params.id)));
    return res.json(book);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

router.delete("/api/books/:id", requireAdmin(), async (req, res) => {
  try {
    const db = await getDb();
    await db.run("DELETE FROM books WHERE id = ?", parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/genres", requireUser(), async (req, res) => {
  try {
    const db = await getDb();
    const genres = (await db.all("SELECT DISTINCT genre FROM books ORDER BY genre")).map((r) => r.genre);
    res.json(genres);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/books/:id/reviews", requireUser(), async (req, res) => {
  try {
    const db = await getDb();
    const reviews = await db.all("SELECT * FROM reviews WHERE book_id = ? ORDER BY id DESC", parseInt(req.params.id));
    res.json(reviews);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
