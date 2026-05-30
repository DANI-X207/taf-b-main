const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "..", "data", "bookstore.db");

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "");

let dbPromise = null;

function getDb() {
  if (!dbPromise) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    dbPromise = open({ filename: DB_PATH, driver: sqlite3.Database }).then(async (db) => {
      await db.exec("PRAGMA journal_mode = WAL");
      await db.exec("PRAGMA foreign_keys = ON");
      return db;
    });
  }
  return dbPromise;
}

async function addColumnIfMissing(db, table, column, definition) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  if (!cols.some((r) => r.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initDb() {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL,
      auteur TEXT NOT NULL,
      genre TEXT NOT NULL,
      prix INTEGER NOT NULL,
      description TEXT,
      image TEXT,
      stock INTEGER DEFAULT 10,
      featured INTEGER DEFAULT 0,
      sales INTEGER DEFAULT 0,
      infos TEXT DEFAULT '',
      created_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      delivery_zone TEXT NOT NULL,
      delivery_address TEXT NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'En attente',
      email_status TEXT DEFAULT 'pending',
      tracking_token TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT DEFAULT '',
      cancelled_at TEXT,
      cancel_requested INTEGER DEFAULT 0,
      cancel_reason TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      book_id INTEGER,
      titre TEXT NOT NULL,
      auteur TEXT NOT NULL,
      prix INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      image TEXT,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      user_id INTEGER,
      customer_name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(book_id) REFERENCES books(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS admin_phones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      is_super INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      added_by TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS user_modifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      old_data TEXT NOT NULL,
      new_data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS wishlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, book_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(book_id) REFERENCES books(id)
    );
  `);

  await addColumnIfMissing(db, "books", "infos", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "books", "created_at", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "orders", "user_id", "INTEGER REFERENCES users(id)");
  await addColumnIfMissing(db, "orders", "tracking_token", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "orders", "updated_at", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "orders", "admin_confirmed", "INTEGER DEFAULT 0");
  await addColumnIfMissing(db, "orders", "client_confirmed", "INTEGER DEFAULT 0");
  await addColumnIfMissing(db, "orders", "validated_at", "TEXT");
  await addColumnIfMissing(db, "orders", "client_received", "INTEGER DEFAULT 0");
  await addColumnIfMissing(db, "orders", "received_at", "TEXT");
  await addColumnIfMissing(db, "orders", "not_received_reported_at", "TEXT");
  await addColumnIfMissing(db, "orders", "not_received_reason", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "users", "phone", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "users", "is_active", "INTEGER DEFAULT 1");
  await addColumnIfMissing(db, "users", "avatar", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "reviews", "user_id", "INTEGER REFERENCES users(id)");

  const bookCount = (await db.get("SELECT COUNT(*) as c FROM books")).c;
  if (bookCount === 0) {
    const books = [
      ["L'Alchimiste", "Paulo Coelho", "Roman", 4500, "Un berger andalou part à la recherche d'un trésor au pied des pyramides d'Égypte.", "https://covers.openlibrary.org/b/id/8739161-L.jpg", 15, 1, "Best-seller international"],
      ["Le Petit Prince", "Antoine de Saint-Exupéry", "Jeunesse", 3500, "Un conte philosophique et poétique sous l'apparence d'un conte pour enfants.", "https://covers.openlibrary.org/b/id/8226191-L.jpg", 20, 1, "Lecture scolaire et familiale"],
      ["Sapiens", "Yuval Noah Harari", "Sciences", 6500, "Une brève histoire de l'humanité, de la préhistoire à nos jours.", "https://covers.openlibrary.org/b/id/8739173-L.jpg", 8, 1, "Essai historique"],
      ["1984", "George Orwell", "Roman", 4000, "Dans un État totalitaire, Big Brother surveille chaque citoyen.", "https://covers.openlibrary.org/b/id/7222246-L.jpg", 12, 0, "Classique dystopique"],
      ["Les Misérables", "Victor Hugo", "Roman", 5500, "L'épopée de Jean Valjean dans la France du XIXe siècle.", "https://covers.openlibrary.org/b/id/2423902-L.jpg", 6, 0, "Grand classique"],
      ["Thinking, Fast and Slow", "Daniel Kahneman", "Développement", 5000, "Deux systèmes de pensée qui guident nos jugements et décisions.", "https://covers.openlibrary.org/b/id/8171393-L.jpg", 9, 1, "Psychologie cognitive"],
      ["Atomic Habits", "James Clear", "Développement", 4800, "Comment construire de bonnes habitudes et en finir avec les mauvaises.", "https://covers.openlibrary.org/b/id/10309902-L.jpg", 14, 0, "Développement personnel"],
      ["Dune", "Frank Herbert", "Science-Fiction", 5200, "Une fresque épique sur la planète désert Arrakis et son précieux épice.", "https://covers.openlibrary.org/b/id/8087474-L.jpg", 7, 0, "Saga culte"],
      ["Le Comte de Monte-Cristo", "Alexandre Dumas", "Roman", 6000, "La vengeance d'Edmond Dantès, injustement emprisonné au château d'If.", "https://covers.openlibrary.org/b/id/8739051-L.jpg", 5, 1, "Aventure et vengeance"],
      ["Harry Potter à l'école des sorciers", "J.K. Rowling", "Jeunesse", 3800, "Un jeune garçon découvre qu'il est un sorcier et entre à Poudlard.", "https://covers.openlibrary.org/b/id/10110415-L.jpg", 18, 0, "Fantaisie jeunesse"],
      ["Homo Deus", "Yuval Noah Harari", "Sciences", 6000, "Une brève histoire de l'avenir de l'humanité.", "https://covers.openlibrary.org/b/id/8739174-L.jpg", 10, 0, "Prospective"],
      ["La Ferme des Animaux", "George Orwell", "Roman", 3200, "Une fable politique sur la corruption du pouvoir.", "https://covers.openlibrary.org/b/id/8233027-L.jpg", 11, 0, "Satire politique"],
    ];
    await db.exec("BEGIN");
    try {
      for (const b of books) {
        await db.run(
          "INSERT INTO books (titre, auteur, genre, prix, description, image, stock, featured, infos, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          ...b, nowIso()
        );
      }
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  }

  const adCount = (await db.get("SELECT COUNT(*) as c FROM ads")).c;
  if (adCount === 0) {
    await db.run(
      "INSERT INTO ads (title, message, link, active, created_at) VALUES (?, ?, ?, ?, ?)",
      "Livraison ciblée",
      "Commandez vos livres dans la zone Potopoto la gare, Saint Exupérie, Présidence, OSH ou CHU.",
      "",
      1,
      nowIso()
    );
  }

  await db.exec(`
    UPDATE orders SET status = 'Confirmée' WHERE status IN ('confirmed');
    UPDATE orders SET status = 'Annulée' WHERE status = 'cancelled';
    UPDATE orders SET status = 'En attente' WHERE status NOT IN ('En attente', 'Confirmée', 'En livraison', 'Livrée', 'Annulée', 'Validée', 'Reçue');
  `);
  await db.run("UPDATE orders SET tracking_token = lower(hex(randomblob(16))) WHERE tracking_token IS NULL OR tracking_token = ''");
  await db.run("UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''");

  const { normalizePhone, formatPhone } = require("./helpers");
  const SEED_ADMIN_PHONES = [
    ["065487909", 1],  // Super Admin
    ["050271841", 1],  // Super Admin
    ["064280982", 0],  // Admin simple
    ["066342094", 0],  // Admin simple
    ["066059986", 0],  // Admin simple
    ["069680847", 0],  // Admin simple
  ];

  const adminPhoneCount = (await db.get("SELECT COUNT(*) as c FROM admin_phones")).c;
  if (adminPhoneCount === 0) {
    for (const [raw_phone, is_super] of SEED_ADMIN_PHONES) {
      await db.run(
        "INSERT INTO admin_phones (phone, is_super, created_at, added_by) VALUES (?,?,?,?)",
        formatPhone(raw_phone), is_super, nowIso(), "system"
      );
    }
  } else {
    // Migration: format existing ones
    const rows = await db.all("SELECT id, phone FROM admin_phones");
    for (const row of rows) {
      const formatted = formatPhone(row.phone);
      if (formatted && formatted !== row.phone) {
        try {
          await db.run("UPDATE admin_phones SET phone = ? WHERE id = ?", formatted, row.id);
        } catch (e) {
          await db.run("DELETE FROM admin_phones WHERE id = ?", row.id);
        }
      }
    }
    // Migration: align Super / simple admin role
    for (const [raw_phone, expected_super] of SEED_ADMIN_PHONES) {
      const target = formatPhone(raw_phone);
      const existingRows = await db.all("SELECT id, phone, is_super FROM admin_phones");
      let found = false;
      for (const row of existingRows) {
        if (normalizePhone(row.phone) === normalizePhone(target)) {
          found = true;
          if (parseInt(row.is_super) !== parseInt(expected_super)) {
            await db.run("UPDATE admin_phones SET is_super = ? WHERE id = ?", expected_super, row.id);
          }
          break;
        }
      }
      if (!found) {
        try {
          await db.run(
            "INSERT INTO admin_phones (phone, is_super, created_at, added_by) VALUES (?,?,?,?)",
            target, expected_super, nowIso(), "system"
          );
        } catch (e) {}
      }
    }
  }
  
  try {
    await db.exec("ALTER TABLE orders ADD COLUMN cancel_requested INTEGER DEFAULT 0");
  } catch(e){}
  try {
    await db.exec("ALTER TABLE orders ADD COLUMN cancel_reason TEXT");
  } catch(e){}
}

module.exports = { getDb, nowIso, initDb };
