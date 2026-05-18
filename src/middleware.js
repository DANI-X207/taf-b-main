const { getDb } = require("./db");

async function getCurrentUserAdminEntry(req) {
  const user = await getCurrentUser(req);
  if (!user) return null;
  const phone = user.phone;
  if (!phone) return null;
  const { normalizePhone } = require("./helpers");
  const norm = normalizePhone(phone);
  if (!norm) return null;
  const db = await getDb();
  const rows = await db.all("SELECT * FROM admin_phones");
  for (const row of rows) {
    if (normalizePhone(row.phone) === norm) {
      return row;
    }
  }
  return null;
}

async function getCurrentAdminRole(req) {
  if (req.session.admin_authenticated) {
    return req.session.admin_role || "normal";
  }
  const entry = await getCurrentUserAdminEntry(req);
  if (entry) {
    return entry.is_super ? "super" : "normal";
  }
  return null;
}

function requireAdmin() {
  return async (req, res, next) => {
    if (req.session.admin_authenticated) {
      return next();
    }
    try {
      const entry = await getCurrentUserAdminEntry(req);
      if (entry) {
        return next();
      }
    } catch (e) {
      return res.status(500).json({ error: "Erreur serveur lors de la vérification admin." });
    }
    return res.status(401).json({ error: "Accès administrateur requis." });
  };
}

function requireUser() {
  return async (req, res, next) => {
    if (req.session.admin_authenticated) {
      return next();
    }
    const user = await getCurrentUser(req);
    if (user) {
      return next();
    }
    return res.status(401).json({ error: "Votre compte a été désactivé ou vous n'êtes pas connecté." });
  };
}

async function getCurrentUser(req) {
  const userId = req.session.user_id;
  if (!userId) return null;
  const db = await getDb();
  const row = await db.get("SELECT * FROM users WHERE id = ?", userId);
  if (!row) {
    delete req.session.user_id;
    return null;
  }
  if (row.is_active === 0) {
    delete req.session.user_id;
    return null;
  }
  const { password_hash, ...user } = row;
  return user;
}

function isAuthenticated(req) {
  return !!(req.session.user_id || req.session.admin_authenticated);
}

module.exports = {
  requireAdmin,
  requireUser,
  getCurrentUser,
  isAuthenticated,
  getCurrentUserAdminEntry,
  getCurrentAdminRole,
};
