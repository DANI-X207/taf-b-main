const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { getDb, nowIso } = require("../db");
const { cleanText, cleanEmail, cleanPassword, cleanPhone, normalizePhone, formatPhone, escapeHtml } = require("../helpers");
const { getCurrentUser, isAuthenticated } = require("../middleware");
const { authPageHtml } = require("./pages");

const router = express.Router();

function resetPasswordHtml(content) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Librairie Mayombe — Réinitialisation</title><style>body{margin:0;min-height:100vh;background:#e8e8e8;font-family:Arial,sans-serif;color:#333;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;}main{width:min(480px,100%);background:#fff;border-radius:6px;padding:34px;box-shadow:0 8px 32px rgba(0,0,0,.18);}h1{font-size:26px;font-weight:400;color:#888;margin:0 0 18px;}label{display:block;font-size:13px;color:#555;margin:14px 0 6px;}input{width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:3px;font-size:14px;background:#f0f0f0;color:#333;box-sizing:border-box;}button,.link{display:inline-block;width:100%;padding:13px;background:#ff690c;color:#fff;font-size:15px;font-weight:600;border:none;border-radius:3px;cursor:pointer;text-align:center;text-decoration:none;box-sizing:border-box;margin-top:18px;}.error{background:#fee4e2;color:#b42318;padding:10px 14px;border-radius:4px;font-size:13px;}.success{background:#ecfdf3;color:#1f7a4d;padding:10px 14px;border-radius:4px;font-size:13px;}.small{font-size:13px;color:#888;line-height:1.5;word-break:break-word;}</style></head><body><main>${content}</main></body></html>`;
}

function buildResetLink(req, token) {
  return `${req.protocol}://${req.get("host")}/reset-password?token=${encodeURIComponent(token)}`;
}

function tokenIsValid(row) {
  return row && !row.used_at && new Date(row.expires_at).getTime() > Date.now();
}

async function phoneMatchesUser(db, user, phone) {
  const normalized = normalizePhone(phone);
  if (normalizePhone(user.phone) === normalized) return true;
  const orders = await db.all(
    "SELECT customer_phone FROM orders WHERE user_id = ? OR (LOWER(customer_email) = LOWER(?) AND LOWER(customer_name) = LOWER(?))",
    user.id, user.email, user.name
  );
  return orders.some((order) => normalizePhone(order.customer_phone) === normalized);
}

async function findResetUser(db, name, phone, email) {
  const user = await db.get("SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND COALESCE(is_active, 1) = 1", email);
  if (!user) return null;
  const enteredName = name.toLowerCase();
  const storedName = String(user.name || "").trim().toLowerCase();
  const nameMatches = storedName === enteredName || storedName.includes(enteredName) || enteredName.includes(storedName);
  if (nameMatches && (await phoneMatchesUser(db, user, phone))) return user;
  return null;
}

router.post("/auth/register", async (req, res) => {
  const data = req.body || {};
  try {
    const name = cleanText(data.name || data.username, 120, true);
    const email = cleanEmail(data.email);
    const rawPhone = cleanPhone(data.phone || data.telephone);
    const phone = rawPhone ? formatPhone(rawPhone) : "";
    const password = cleanPassword(data.password);
    const hash = await bcrypt.hash(password, 12);
    const db = await getDb();
    
    const existingName = await db.get("SELECT id FROM users WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))", name);
    if (existingName) throw new Error("Ce nom complet est déjà utilisé, veuillez en choisir un autre par précaution.");
    
    const existingEmail = await db.get("SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))", email);
    if (existingEmail) throw new Error("Cet email est déjà associé à un autre compte.");
    
    const existingPhone = await db.get("SELECT id FROM users WHERE phone = ?", phone);
    if (existingPhone && phone !== "") throw new Error("Ce numéro de téléphone est déjà associé à un compte.");

    let userId;
    try {
      const result = await db.run(
        "INSERT INTO users (name, email, phone, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        name, email, phone, hash, nowIso()
      );
      userId = result.lastID;
    } catch (e) {
      const msg = "Un compte existe déjà avec cet email ou ce nom d'utilisateur.";
      if (req.is("json")) return res.status(409).json({ error: msg, redirectTo: "/login.html" });
      return res.redirect("/login.html?info=" + encodeURIComponent("Compte déjà existant. Connectez-vous."));
    }
    req.session.user_id = userId;
    if (req.is("json")) return res.status(201).json({ success: true });
    return res.redirect("/");
  } catch (e) {
    if (req.is("json")) return res.status(400).json({ error: e.message });
    return res.status(400).send(authPageHtml(e.message));
  }
});

router.post("/auth/login", async (req, res) => {
  const data = req.body || {};
  try {
    const identifier = cleanText(data.email || data.username || data.identifier || "", 180, true);
    const password = String(data.password || "");
    const remember = data.remember === "on" || data.remember === true || data.remember === "true";
    const db = await getDb();
    let matchedRow = null;
    const candidates = await db.all(
      "SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(?) OR LOWER(TRIM(name)) = LOWER(?)",
      identifier, identifier
    );
    for (const candidate of candidates) {
      if (candidate.password_hash && await bcrypt.compare(password, candidate.password_hash)) {
        matchedRow = candidate;
        break;
      }
    }
    if (!matchedRow) {
      const msg = "Identifiant ou mot de passe incorrect.";
      if (req.is("json")) return res.status(401).json({ error: msg });
      return res.status(401).send(authPageHtml(msg));
    }
    if (matchedRow.is_active === 0) {
      const msg = "Votre compte a été désactivé par l'administrateur.";
      if (req.is("json")) return res.status(403).json({ error: msg });
      return res.status(403).send(authPageHtml(msg));
    }
    await db.run("UPDATE users SET last_login_at = ? WHERE id = ?", nowIso(), matchedRow.id);
    req.session.user_id = matchedRow.id;
    if (remember) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    } else {
      req.session.cookie.expires = false;
    }
    if (req.is("json")) return res.json({ success: true });
    return res.redirect("/");
  } catch (e) {
    if (req.is("json")) return res.status(400).json({ error: e.message });
    return res.status(400).send(authPageHtml(e.message));
  }
});

router.all("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("magma_sid");
    if (req.is("json")) return res.json({ success: true });
    return res.redirect("/login.html");
  });
});

router.post("/api/auth/forgot-password", async (req, res) => {
  const data = req.body || {};
  try {
    const name = cleanText(data.name, 120, true);
    const phone = cleanPhone(data.phone || data.telephone);
    const email = cleanEmail(data.email);
    const db = await getDb();
    await db.run("DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at <= ?", new Date().toISOString());
    const user = await findResetUser(db, name, phone, email);
    if (!user) {
      return res.status(400).json({ error: "Les informations saisies ne correspondent à aucun compte client." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db.run(
      "INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)",
      user.id, token, expiresAt, nowIso()
    );
    const resetLink = buildResetLink(req, token);
    return res.json({ success: true, message: "Lien de réinitialisation généré. Il expire dans 15 minutes.", resetLink });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Impossible de vérifier les informations." });
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  const data = req.body || {};
  try {
    const name = cleanText(data.name, 120, true);
    const phone = cleanPhone(data.phone || data.telephone);
    const email = cleanEmail(data.email);
    const db = await getDb();
    await db.run("DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at <= ?", new Date().toISOString());
    const user = await findResetUser(db, name, phone, email);
    if (!user) {
      return res.status(400).send(resetPasswordHtml(`<h1>Mot de passe oublié</h1><p class="error">Les informations saisies ne correspondent à aucun compte client.</p><a class="link" href="/login.html">Retour</a>`));
    }
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db.run(
      "INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)",
      user.id, token, expiresAt, nowIso()
    );
    const resetLink = buildResetLink(req, token);
    return res.send(resetPasswordHtml(`<h1>Lien de réinitialisation</h1><p class="success">Lien généré. Il expire dans 15 minutes.</p><p class="small"><a href="${escapeHtml(resetLink)}">${escapeHtml(resetLink)}</a></p><a class="link" href="${escapeHtml(resetLink)}">Saisir un nouveau mot de passe</a>`));
  } catch (e) {
    return res.status(400).send(resetPasswordHtml(`<h1>Mot de passe oublié</h1><p class="error">${escapeHtml(e.message || "Impossible de vérifier les informations.")}</p><a class="link" href="/login.html">Retour</a>`));
  }
});

router.get("/reset-password", async (req, res) => {
  const token = cleanText(req.query.token, 200);
  const db = await getDb();
  await db.run("DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at <= ?", new Date().toISOString());
  const row = token ? await db.get("SELECT * FROM password_reset_tokens WHERE token = ?", token) : null;
  if (!tokenIsValid(row)) {
    return res.status(400).send(resetPasswordHtml(`<h1>Réinitialisation</h1><p class="error">Ce lien est invalide ou expiré. Demandez un nouveau lien depuis la page de connexion.</p><a class="link" href="/login.html">Retour à la connexion</a>`));
  }
  return res.send(resetPasswordHtml(`<h1>Nouveau mot de passe</h1><p class="small">Saisissez un nouveau mot de passe. Le lien sera désactivé après validation.</p><form method="post" action="/auth/reset-password"><input type="hidden" name="token" value="${escapeHtml(token)}"><label>Nouveau mot de passe</label><input name="password" type="password" required minlength="8" autocomplete="new-password"><button type="submit">Réinitialiser</button></form>`));
});

router.post("/auth/reset-password", async (req, res) => {
  const data = req.body || {};
  try {
    const token = cleanText(data.token, 200, true);
    const password = cleanPassword(data.password);
    const db = await getDb();
    await db.run("DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at <= ?", new Date().toISOString());
    const row = await db.get("SELECT * FROM password_reset_tokens WHERE token = ?", token);
    if (!tokenIsValid(row)) {
      const msg = "Ce lien est invalide ou expiré.";
      if (req.is("json")) return res.status(400).json({ error: msg });
      return res.status(400).send(resetPasswordHtml(`<h1>Réinitialisation</h1><p class="error">${msg}</p><a class="link" href="/login.html">Retour</a>`));
    }
    const hash = await bcrypt.hash(password, 12);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", hash, row.user_id);
    await db.run("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", nowIso(), row.id);
    req.session.destroy(() => {
      res.clearCookie("magma_sid");
      if (req.is("json")) return res.json({ success: true, message: "Mot de passe réinitialisé. Connectez-vous avec votre nouveau mot de passe." });
      return res.send(resetPasswordHtml(`<h1>Mot de passe réinitialisé</h1><p class="success">Votre mot de passe a été mis à jour. Votre session a été fermée par sécurité.</p><a class="link" href="/login.html">Se connecter</a>`));
    });
  } catch (e) {
    if (req.is("json")) return res.status(400).json({ error: e.message || "Réinitialisation impossible." });
    return res.status(400).send(resetPasswordHtml(`<h1>Réinitialisation</h1><p class="error">${escapeHtml(e.message || "Réinitialisation impossible.")}</p><a class="link" href="/login.html">Retour</a>`));
  }
});

router.get("/api/auth/status", async (req, res) => {
  const user = await getCurrentUser(req);
  res.json({ authenticated: isAuthenticated(req), user, admin: !!req.session.admin_authenticated });
});

router.put("/api/users/me", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: "Non autorisé" });
  const data = req.body || {};
  try {
    const db = await getDb();
    const name = data.name ? cleanText(data.name, 120, true) : user.name;
    const email = data.email ? cleanEmail(data.email) : user.email;
    const rawPhone = data.phone !== undefined ? cleanPhone(data.phone) : user.phone;
    const phone = rawPhone ? formatPhone(rawPhone) : "";
    const avatar = data.avatar !== undefined ? cleanText(data.avatar, 5000000) : (user.avatar || ""); // base64 avatar

    // Check duplicates if changed
    if (name.toLowerCase() !== user.name.toLowerCase()) {
      const exist = await db.get("SELECT id FROM users WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))", name);
      if (exist) throw new Error("Ce nom complet est déjà utilisé, veuillez en choisir un autre par précaution.");
    }
    if (email.toLowerCase() !== user.email.toLowerCase()) {
      const exist = await db.get("SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))", email);
      if (exist) throw new Error("Cet email est déjà associé à un autre compte.");
    }
    if (phone !== formatPhone(user.phone) && phone !== "") {
      const exist = await db.get("SELECT id FROM users WHERE phone = ?", phone);
      if (exist) throw new Error("Ce numéro de téléphone est déjà associé à un compte.");
    }

    const oldInfo = { name: user.name, email: user.email, phone: user.phone, avatar: user.avatar };
    const newInfo = { name, email, phone, avatar };
    
    let passwordHash = user.password_hash;
    let pwdChanged = false;
    if (data.password && data.password.trim().length >= 8) {
      passwordHash = await bcrypt.hash(data.password, 12);
      pwdChanged = true;
    } else if (data.password && data.password.trim().length > 0) {
      throw new Error("Le mot de passe doit faire au moins 8 caractères.");
    }

    const changed = pwdChanged || oldInfo.name !== newInfo.name || oldInfo.email !== newInfo.email || oldInfo.phone !== newInfo.phone || oldInfo.avatar !== newInfo.avatar;

    if (changed) {
      await db.run("UPDATE users SET name = ?, email = ?, phone = ?, avatar = ?, password_hash = ? WHERE id = ?", name, email, phone, avatar, passwordHash, user.id);
      await db.run(
        "INSERT INTO user_modifications (user_id, old_data, new_data, created_at, is_read) VALUES (?, ?, ?, ?, 0)",
        user.id, JSON.stringify(oldInfo), JSON.stringify(newInfo), nowIso()
      );
    }
    
    return res.json({ success: true, user: { ...user, name, email, phone, avatar } });
  } catch(e) {
    return res.status(400).json({ error: e.message });
  }
});

router.post("/api/auth/register", (req, res, next) => {
  req.url = "/auth/register";
  router.handle(req, res, next);
});
router.post("/api/auth/login", (req, res, next) => {
  req.url = "/auth/login";
  router.handle(req, res, next);
});
router.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("magma_sid");
    res.json({ success: true });
  });
});

module.exports = router;
