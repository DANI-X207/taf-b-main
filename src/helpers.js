const { URL } = require("url");

function cleanText(value, maxLen = 500, required = false) {
  const text = String(value || "").trim();
  if (required && !text) throw new Error("Champ obligatoire manquant");
  return text.slice(0, maxLen);
}

function cleanInt(value, minValue = 0, defaultVal = 0) {
  const n = parseInt(value, 10);
  const num = isNaN(n) ? defaultVal : n;
  return Math.max(minValue, num);
}

function cleanEmail(value) {
  const email = cleanText(value, 180, false).toLowerCase();
  if (!email) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Adresse email invalide");
  return email;
}

function cleanPassword(value) {
  const password = String(value || "");
  if (password.length < 8) throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    throw new Error("Le mot de passe doit contenir au moins une lettre et un chiffre.");
  return password;
}

function cleanPhone(value) {
  const phone = cleanText(value, 40, true);
  if (!/^[+0-9 ()\-.]{6,40}$/.test(phone)) throw new Error("Numéro de téléphone invalide");
  return phone;
}

function normalizePhone(value) {
  if (!value) return "";
  let digits = String(value).replace(/\D+/g, "");
  if (digits.length > 9 && digits.startsWith("242")) {
    digits = digits.slice(3);
  }
  if (digits.length === 8) {
    digits = "0" + digits;
  }
  return digits;
}

function formatPhone(value) {
  const digits = normalizePhone(value);
  return digits || (value ? String(value) : "");
}

function cleanUrl(value, maxLen = 700) {
  const url = cleanText(value, maxLen);
  if (!url) return "";
  if (url.startsWith("/")) return url;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error("URL invalide");
  }
  return url;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowToBook(row) {
  return {
    ...row,
    prix: parseInt(row.prix) || 0,
    stock: parseInt(row.stock) || 0,
    featured: parseInt(row.featured) || 0,
  };
}

module.exports = { cleanText, cleanInt, cleanEmail, cleanPassword, cleanPhone, normalizePhone, formatPhone, cleanUrl, escapeHtml, rowToBook };
