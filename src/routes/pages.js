const express = require("express");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const { isAuthenticated } = require("../middleware");

const router = express.Router();

const SITE_NAME = "Librairie Magma";
const PUBLIC_HTML = path.join(__dirname, "..", "..", "public", "html");
const PUBLIC_CSS = path.join(__dirname, "..", "..", "public", "css");
const PUBLIC_IMG = path.join(__dirname, "..", "..", "public", "img");
const PUBLIC_JS = path.join(__dirname, "..", "..", "public", "js");
const BASE_DIR = path.join(__dirname, "..", "..");

const PAGE_TITLES = {
  index: `${SITE_NAME} — Accueil`,
  login: `${SITE_NAME} — Connexion`,
  "Mon-panier": `${SITE_NAME} — Mon Panier`,
  "Ajout-Produit": `${SITE_NAME} — Ajouter un Livre`,
  MABOUTIQUE: `${SITE_NAME} — Ma Boutique`,
  PI_Produit: `${SITE_NAME} — Détail du Livre`,
  Formulaire: `${SITE_NAME} — Formulaire`,
  "PAGEMOD-Accueil": SITE_NAME,
  Admin: `${SITE_NAME} — Admin`,
};

const PROTECTED_PAGES = new Set(["index.html", "Accueil-v2.html", "PAGEMOD-Accueil.html", "Mon-panier.html", "Formulaire.html", "mon-compte.html", "mes-commandes.html", "parametres.html"]);
const AUTH_PAGES = new Set(["login.html", "connexion.html", "register.html", "inscription.html"]);

const HEAD_COMPAT = `<script>
window.clWDUtil = new Proxy(window.clWDUtil || {}, {
  get: function(target, prop) {
    if (prop in target) return target[prop];
    if (prop === "pfGetTraitement") return function() { return function() {}; };
    return function() { return function() {}; };
  }
});
window.oGetObjetChamp = window.oGetObjetChamp || function() {
  return { OnClick: function(){}, OnMouseOver: function(){}, OnMouseOut: function(){} };
};
window.WDBandeauDefilant = window.WDBandeauDefilant || function() {
  return { Init:function(){}, Demarre:function(){}, Arrete:function(){} };
};
["WDAnim","WDChamp","WDDrag","WDImage","WDMenu","WDOnglet","WDSaisie","WDTableZRCommun","WDUtil","WDZRNavigateur"]
.forEach(function(name) {
  window[name] = window[name] || function() {
    return { Init:function(){}, OnClick:function(){}, OnMouseOver:function(){}, OnMouseOut:function(){} };
  };
});
window.wbImgHomNav = window.wbImgHomNav || function(){};
</script>
</head>`;

function authPageHtml(message = "") {
  const msg = message ? `<p class="error">${message.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>` : "";
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${SITE_NAME} — Connexion client</title>
<style>
body{margin:0;min-height:100vh;background:linear-gradient(135deg,#ff690c,#f59e0b 45%,#2b293a);font-family:Arial,sans-serif;color:#2b293a;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;}
main{width:min(980px,100%);background:rgba(255,255,255,.96);border-radius:28px;padding:28px;box-shadow:0 30px 90px rgba(0,0,0,.25);}
h1{margin:0 0 8px;font-size:34px;}p{line-height:1.5;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;margin-top:20px;}
.card{background:#fff7ed;border:1px solid #fed7aa;border-radius:20px;padding:20px;}
input{width:100%;padding:12px;margin:7px 0;border:1px solid #ddd;border-radius:12px;box-sizing:border-box;}
button,.link{display:inline-block;background:#ff690c;color:#fff;border:0;border-radius:999px;padding:12px 18px;text-decoration:none;font-weight:700;cursor:pointer;margin-top:8px;}
.admin{background:#2b293a;}.error{background:#fee4e2;color:#b42318;padding:12px;border-radius:12px;}
.small{font-size:13px;color:#667085;}
</style>
</head>
<body>
<main>
<h1>${SITE_NAME}</h1>
<p>Créez un compte ou connectez-vous pour accéder au catalogue, au panier et aux commandes.</p>
${msg}
<div class="grid">
<section class="card">
<h2>Créer un compte</h2>
<form method="post" action="/auth/register">
<input name="name" placeholder="Nom complet" required maxlength="120" autocomplete="name">
<input name="email" type="email" placeholder="Email" required maxlength="180" autocomplete="email">
<input name="phone" placeholder="Numéro de téléphone" required maxlength="40" autocomplete="tel">
<input name="password" type="password" placeholder="Mot de passe avec lettre et chiffre" required minlength="8" autocomplete="new-password">
<button type="submit">Créer mon compte</button>
</form>
</section>
<section class="card">
<h2>Déjà client</h2>
<form method="post" action="/auth/login">
<input name="email" type="email" placeholder="Email" required maxlength="180" autocomplete="email">
<input name="password" type="password" placeholder="Mot de passe" required autocomplete="current-password">
<button type="submit">Me connecter</button>
</form>
<p class="small"><a href="#" id="forgot-password-link">Mot de passe oublié</a></p>
</section>
</div>
<p><a class="link admin" href="/Admin.html">Connexion Admin</a> <a class="link" href="/api/source.zip">Télécharger le code source</a></p>
<p class="small">Session sécurisée : cookie HttpOnly, Secure, SameSite strict, expiration configurable à 7 jours par défaut.</p>
</main>
</body>
</html>`;
}

function serveHtml(filename, req, res) {
  if (AUTH_PAGES.has(filename)) {
    if (isAuthenticated(req)) return res.redirect("/");
  }
  if (PROTECTED_PAGES.has(filename) && !isAuthenticated(req)) {
    return res.redirect("/login.html");
  }
  const filepath = path.join(PUBLIC_HTML, filename);
  if (!fs.existsSync(filepath)) return res.status(404).send("Page non trouvée");

  let content = fs.readFileSync(filepath, "utf8");
  const pageKey = filename.replace(/\.html$/, "");
  const newTitle = PAGE_TITLES[pageKey] || SITE_NAME;
  content = content.replace(/<title>[^<]*<\/title>/, `<title>${newTitle}</title>`);
  content = content.replace(/(>)([^<]*)Mayombe([^<]*<)/g, (m, a, b, c) => a + b + SITE_NAME + c);
  if (!content.includes("window.clWDUtil")) {
    content = content.replace("</head>", HEAD_COMPAT);
  }
  if (!content.includes("magma-fixes.css")) {
    content = content.replace("</head>", '<link rel="stylesheet" type="text/css" href="/magma-fixes.css"></head>');
  }
  if (!content.includes("/js/bookstore.js")) {
    content = content.replace("</body>", '<script src="/js/bookstore.js"></script></body>');
  }
  res.type("html").send(content);
}

router.get("/", (req, res) => {
  if (isAuthenticated(req)) return serveHtml("Accueil-v2.html", req, res);
  return serveHtml("vitrine.html", req, res);
});

router.get("/index.html", (req, res) => res.redirect("/"));

router.get("/favicon.ico", (req, res) => res.status(204).end());

function serveAdminDashboard(role, req, res) {
  if (!req.session.admin_authenticated) return res.redirect("/Admin.html");
  if (req.session.admin_role !== role) {
    return res.redirect(req.session.admin_role === "super" ? "/super-admin.html" : "/admin.html");
  }
  const filepath = path.join(PUBLIC_HTML, "Admin.html");
  let content = fs.readFileSync(filepath, "utf8");
  content = content.replace(/<title>[^<]*<\/title>/, `<title>${SITE_NAME} — ${role === "super" ? "Super Admin" : "Admin"}</title>`);
  // Hide login screen, force show dashboard
  content = content.replace('<div id="admin-login-screen">', '<div id="admin-login-screen" style="display:none!important;">');
  content = content.replace('<div id="admin-dashboard">', '<div id="admin-dashboard" style="display:block;">');
  // Inject role marker for client JS
  content = content.replace("</head>", `<script>window.MAGMA_ADMIN_ROLE=${JSON.stringify(role)};window.MAGMA_ADMIN_PAGE=true;</script><script>(function(){var orig=window.fetch;})();</script></head>`);
  // Inject magma-fixes css + bookstore.js
  if (!content.includes("magma-fixes.css")) {
    content = content.replace("</head>", '<link rel="stylesheet" href="/magma-fixes.css"></head>');
  }
  if (!content.includes("/js/bookstore.js")) {
    content = content.replace("</body>", '<script src="/js/bookstore.js"></script></body>');
  }
  // Mark body for CSS scoping
  content = content.replace("<body>", `<body class="admin-page admin-${role}">`);
  res.type("html").send(content);
}

// Case-sensitive guard: only the lowercase paths are role-locked dashboards.
// /Admin.html (capital A) is the original WEBDEV login page and must fall through to serveHtml.
router.get("/admin.html", (req, res, next) => {
  if (req.path !== "/admin.html") return next();
  return serveAdminDashboard("normal", req, res);
});
router.get("/super-admin.html", (req, res, next) => {
  if (req.path !== "/super-admin.html") return next();
  return serveAdminDashboard("super", req, res);
});

router.get("/:filename([^/]+\\.html)", (req, res) => serveHtml(req.params.filename, req, res));

router.get(/^\/(.+\.html)$/, (req, res) => serveHtml(req.params[0], req, res));

router.get("/api/ads", async (req, res) => {
  try {
    const { getDb } = require("../db");
    const db = await getDb();
    const ads = await db.all("SELECT * FROM ads WHERE active = 1 ORDER BY id DESC");
    res.json(ads);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function requireSuperAdmin(req, res) {
  if (!req.session.admin_authenticated) { res.status(403).json({ error: "Accès réservé à l'administrateur." }); return false; }
  if (req.session.admin_role !== "super") { res.status(403).json({ error: "Accès réservé à l'administrateur principal." }); return false; }
  return true;
}

router.get("/api/source.zip", (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="librairie-magma-source.zip"');
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);
  archive.glob("**/*", {
    cwd: BASE_DIR,
    ignore: [
      ".git/**", ".cache/**", ".pythonlibs/**", "__pycache__/**", "node_modules/**",
      ".local/**", "data/bookstore.db", "**/*.pyc", "attached_assets/**",
    ],
  });
  archive.finalize();
});

router.get("/api/source-railway.zip", (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="librairie-magma-railway.zip"');
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);
  archive.glob("**/*", {
    cwd: BASE_DIR,
    ignore: [
      ".git/**", ".cache/**", ".pythonlibs/**", "__pycache__/**", "node_modules/**",
      ".local/**", "data/bookstore.db", "**/*.pyc", "attached_assets/**",
      ".replit", "replit.nix",
    ],
  });
  const procfile = "web: node server.js\n";
  const railwayJson = JSON.stringify({
    "$schema": "https://railway.app/railway.schema.json",
    build: { builder: "NIXPACKS" },
    deploy: { startCommand: "node server.js", restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
  }, null, 2) + "\n";
  const nixpacks = "[phases.setup]\nnixPkgs = ['nodejs_20']\n\n[start]\ncmd = 'node server.js'\n";
  const envExample = "PORT=5000\nSESSION_SECRET=change-me\nADMIN_PASSWORD=TAF1-FLEMME\nADMIN_PASSWORD_SUPER=MMDE2007\n# SMTP_HOST=\n# SMTP_PORT=587\n# SMTP_USER=\n# SMTP_PASSWORD=\n# SMTP_FROM=\n# ORDER_EMAIL=\n";
  const readme = "# Librairie Magma — Déploiement Railway\n\n1. Créez un nouveau projet Railway et importez ce dossier.\n2. Définissez les variables d'environnement (voir `.env.example`).\n3. Railway détecte Node.js automatiquement et utilise `node server.js` comme commande de démarrage.\n4. L'application écoute sur le port défini par `PORT` (5000 par défaut).\n";
  archive.append(procfile, { name: "Procfile" });
  archive.append(railwayJson, { name: "railway.json" });
  archive.append(nixpacks, { name: "nixpacks.toml" });
  archive.append(envExample, { name: ".env.example" });
  archive.append(readme, { name: "RAILWAY.md" });
  archive.finalize();
});

router.get("/api/source-render.zip", (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="librairie-magma-render.zip"');
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);
  // Faithful copy of the project (excluding only build/runtime artifacts that
  // can be regenerated). The archive is generated on demand at every request,
  // so any modification is reflected immediately.
  archive.glob("**/*", {
    cwd: BASE_DIR,
    dot: true,
    ignore: [
      ".git/**", ".cache/**", ".pythonlibs/**", "__pycache__/**",
      "node_modules/**", ".local/**", "data/bookstore.db",
      "**/*.pyc", "attached_assets/**", ".upm/**",
    ],
  });
  const procfile = "web: node server.js\n";
  const renderYaml =
`services:
  - type: web
    name: librairie-magma
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: NODE_VERSION
        value: 20
      - key: SESSION_SECRET
        generateValue: true
      - key: ADMIN_PASSWORD
        sync: false
      - key: ADMIN_PASSWORD_SUPER
        sync: false
`;
  const envExample = "PORT=5000\nSESSION_SECRET=change-me\nADMIN_PASSWORD=TAF1-FLEMME\nADMIN_PASSWORD_SUPER=MMDE2007\n# SMTP_HOST=\n# SMTP_PORT=587\n# SMTP_USER=\n# SMTP_PASSWORD=\n# SMTP_FROM=\n# ORDER_EMAIL=\n";
  const readme =
`# Librairie Magma — Déploiement Render

## Étapes
1. Créez un compte sur https://render.com
2. New + → Web Service → connectez votre dépôt Git contenant ces fichiers
   (ou utilisez "Deploy from a public Git repo").
3. Render lit automatiquement \`render.yaml\` :
   - Runtime : Node 20
   - Build : \`npm install\`
   - Start : \`node server.js\`
4. Définissez vos variables secrètes dans le dashboard Render :
   - \`ADMIN_PASSWORD\`
   - \`ADMIN_PASSWORD_SUPER\`
   - (optionnel) \`SMTP_HOST\`, \`SMTP_USER\`, \`SMTP_PASSWORD\`, \`SMTP_FROM\`
5. \`SESSION_SECRET\` est généré automatiquement par Render.
6. L'application écoute sur le port défini par la variable \`PORT\` injectée par Render.

## Note SQLite
La base SQLite (\`data/bookstore.db\`) est créée au démarrage. Sur le plan
gratuit Render, le disque est éphémère : pour la persistance, ajoutez un
"Disk" dans le dashboard Render et montez-le sur \`/opt/render/project/src/data\`.
`;
  archive.append(procfile, { name: "Procfile" });
  archive.append(renderYaml, { name: "render.yaml" });
  archive.append(envExample, { name: ".env.example" });
  archive.append(readme, { name: "RENDER.md" });
  archive.finalize();
});

router.get("/download-source.zip", (req, res) => res.redirect("/api/source.zip"));

module.exports = { router, authPageHtml };
