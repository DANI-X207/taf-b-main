"""Application Flask de la librairie Magma avec catalogue, comptes clients, commandes, administration et export du code source."""

import io
import json
import logging
import os
import re
import secrets
import smtplib
import sqlite3
import zipfile
from datetime import datetime, timedelta
from email.message import EmailMessage
from functools import wraps
from html import escape
from urllib.parse import urlparse

from email_validator import EmailNotValidError, validate_email
from flask import Flask, Response, jsonify, redirect, request, send_file, send_from_directory, session, url_for
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET")
if not app.secret_key:
    app.secret_key = secrets.token_hex(32)
    app.logger.warning("SESSION_SECRET is not set; using a temporary development secret.")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.config.update(
    PERMANENT_SESSION_LIFETIME=timedelta(days=int(os.environ.get("SESSION_DAYS", "7"))),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower() != "false",
    SESSION_COOKIE_SAMESITE="Strict",
)

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "data", "bookstore.db")
PUBLIC_HTML = os.path.join(BASE_DIR, "public", "html")
PUBLIC_CSS = os.path.join(BASE_DIR, "public", "css")
PUBLIC_IMG = os.path.join(BASE_DIR, "public", "img")
PUBLIC_JS = os.path.join(BASE_DIR, "public", "js")

SITE_NAME = "Librairie Magma"
ADMIN_PASSWORD = "TAF1-FLEMME"
ADMIN_PASSWORD_SUPER = "MMDE2007"
ORDER_EMAIL_TO = "moussokiexauce7@gmail.com"
CANCEL_WINDOW_MINUTES = 5
ORDER_STATUSES = ["En attente", "Confirmée", "En livraison", "Livrée", "Annulée"]
ALLOWED_DELIVERY_ZONES = [
    "Potopoto la gare",
    "Total vers Saint Exupérie",
    "Présidence",
    "OSH",
    "CHU",
]
PROTECTED_PAGES = {
    "index.html",
    "PAGEMOD-Accueil.html",
    "Mon-panier.html",
    "Formulaire.html",
}
SEED_ADMIN_PHONES = [
    ("065487909", 1),  # Super Admin
    ("050271841", 1),  # Super Admin
    ("064280982", 0),  # Admin simple
    ("066342094", 0),  # Admin simple
    ("066059986", 0),  # Admin simple
    ("069680847", 0),  # Admin simple
]
AUTH_PAGES = {"login.html", "connexion.html", "register.html", "inscription.html"}
INJECT_SCRIPT = '<script src="/js/bookstore.js"></script></body>'
HEAD_COMPAT_SCRIPT = """
<script>
window.clWDUtil = new Proxy(window.clWDUtil || {}, {
  get: function (target, prop) {
    if (prop in target) return target[prop];
    if (prop === "pfGetTraitement") {
      return function () { return function () {}; };
    }
    return function () { return function () {}; };
  }
});
window.oGetObjetChamp = window.oGetObjetChamp || function () {
  return {
    OnClick: function () {},
    OnMouseOver: function () {},
    OnMouseOut: function () {}
  };
};
window.WDBandeauDefilant = window.WDBandeauDefilant || function () {
  return {
    Init: function () {},
    Demarre: function () {},
    Arrete: function () {}
  };
};
[
  "WDAnim",
  "WDChamp",
  "WDDrag",
  "WDImage",
  "WDMenu",
  "WDOnglet",
  "WDSaisie",
  "WDTableZRCommun",
  "WDUtil",
  "WDZRNavigateur"
].forEach(function (name) {
  window[name] = window[name] || function () {
    return {
      Init: function () {},
      OnClick: function () {},
      OnMouseOver: function () {},
      OnMouseOut: function () {}
    };
  };
});
window.wbImgHomNav = window.wbImgHomNav || function () {};
</script>
</head>
"""

PAGE_TITLES = {
    "index": SITE_NAME + " — Accueil",
    "login": SITE_NAME + " — Connexion",
    "Mon-panier": SITE_NAME + " — Mon Panier",
    "Ajout-Produit": SITE_NAME + " — Ajouter un Livre",
    "MABOUTIQUE": SITE_NAME + " — Ma Boutique",
    "PI_Produit": SITE_NAME + " — Détail du Livre",
    "Formulaire": SITE_NAME + " — Formulaire",
    "PAGEMOD-Accueil": SITE_NAME,
    "Admin": SITE_NAME + " — Admin",
}


def now_iso():
    """Retourne l'horodatage UTC utilisé par les modules commande, avis et publicité."""
    return datetime.utcnow().isoformat(timespec="seconds")


def parse_iso(value):
    """Convertit une date ISO stockée en base SQLite en objet datetime."""
    return datetime.fromisoformat(value)


def clean_text(value, max_len=500, required=False):
    """Nettoie et limite les textes reçus des formulaires et des appels API."""
    text = str(value or "").strip()
    if required and not text:
        raise ValueError("Champ obligatoire manquant")
    return text[:max_len]


def clean_int(value, min_value=0, default=0):
    """Convertit les valeurs numériques de formulaire avec borne minimale."""
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(min_value, number)


def clean_email(value):
    """Valide une adresse email et renvoie sa forme normalisée."""
    email = clean_text(value, 180, True).lower()
    try:
        return validate_email(email, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise ValueError("Adresse email invalide")


def clean_password(value):
    """Valide la robustesse minimale du mot de passe client."""
    password = str(value or "")
    if len(password) < 8:
        raise ValueError("Le mot de passe doit contenir au moins 8 caractères.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise ValueError("Le mot de passe doit contenir au moins une lettre et un chiffre.")
    return password


def clean_phone(value):
    """Valide les numéros de téléphone utilisés pour les commandes."""
    phone = clean_text(value, 40, True)
    if not re.fullmatch(r"[+0-9 ()\-.]{6,40}", phone):
        raise ValueError("Numéro de téléphone invalide")
    return phone


def normalize_phone(value):
    """Normalise un numéro de téléphone congolais au format local à 9 chiffres (ex: 065487909)."""
    if not value:
        return ""
    digits = re.sub(r"\D+", "", str(value))
    # Supprime un éventuel indicatif international "242" du Congo s'il précède le numéro local
    if len(digits) > 9 and digits.startswith("242"):
        digits = digits[3:]
    # Préfixe avec "0" si l'utilisateur a omis le zéro initial du format local 9 chiffres
    if len(digits) == 8:
        digits = "0" + digits
    return digits


def format_phone(value):
    """Formate un numéro local en XX-XXX-XXXX (ex: 06-548-7909). Renvoie la valeur brute si format inattendu."""
    digits = normalize_phone(value)
    if len(digits) == 9:
        return f"{digits[0:2]}-{digits[2:5]}-{digits[5:9]}"
    return digits or (str(value) if value else "")


def clean_url(value, max_len=700):
    """Valide les URLs utilisées pour les images et les publicités."""
    url = clean_text(value, max_len)
    if not url:
        return ""
    if url.startswith("/uploads/"):
        return url
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("URL invalide")
    return url


def get_db():
    """Ouvre une connexion SQLite configurée pour renvoyer les lignes sous forme de dictionnaires."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def table_columns(conn, table_name):
    """Liste les colonnes existantes pour les migrations légères SQLite."""
    return [row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]


def add_column_if_missing(conn, table_name, column_name, definition):
    """Ajoute une colonne SQLite seulement si elle n'existe pas encore."""
    if column_name not in table_columns(conn, table_name):
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def init_db():
    """Crée et migre les tables SQLite nécessaires aux livres, utilisateurs, commandes, avis et publicités."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_login_at TEXT
        )
    """)
    conn.execute("""
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
            infos TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)
    add_column_if_missing(conn, "books", "infos", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "books", "created_at", "TEXT DEFAULT ''")

    conn.execute("""
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
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)
    add_column_if_missing(conn, "orders", "user_id", "INTEGER REFERENCES users(id)")
    add_column_if_missing(conn, "orders", "tracking_token", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "orders", "updated_at", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "users", "is_active", "INTEGER NOT NULL DEFAULT 1")
    add_column_if_missing(conn, "users", "phone", "TEXT DEFAULT ''")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS password_resets (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
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
        )
    """)
    conn.execute("""
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
        )
    """)
    add_column_if_missing(conn, "reviews", "user_id", "INTEGER REFERENCES users(id)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            link TEXT DEFAULT '',
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS admin_phones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT NOT NULL UNIQUE,
            is_super INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            added_by TEXT DEFAULT ''
        )
    """)
    if conn.execute("SELECT COUNT(*) FROM admin_phones").fetchone()[0] == 0:
        for raw_phone, is_super in SEED_ADMIN_PHONES:
            conn.execute(
                "INSERT INTO admin_phones (phone, is_super, created_at, added_by) VALUES (?,?,?,?)",
                (format_phone(raw_phone), is_super, now_iso(), "system"),
            )
    else:
        # Migration : reformate toute entrée existante au format XX-XXX-XXXX si nécessaire
        for row in conn.execute("SELECT id, phone FROM admin_phones").fetchall():
            formatted = format_phone(row["phone"])
            if formatted and formatted != row["phone"]:
                try:
                    conn.execute("UPDATE admin_phones SET phone = ? WHERE id = ?", (formatted, row["id"]))
                except sqlite3.IntegrityError:
                    conn.execute("DELETE FROM admin_phones WHERE id = ?", (row["id"],))
        # Migration : aligne le rôle (super / simple) des numéros de la liste prédéfinie
        for raw_phone, expected_super in SEED_ADMIN_PHONES:
            target = format_phone(raw_phone)
            for row in conn.execute("SELECT id, phone, is_super FROM admin_phones").fetchall():
                if normalize_phone(row["phone"]) == normalize_phone(target):
                    if int(row["is_super"]) != int(expected_super):
                        conn.execute(
                            "UPDATE admin_phones SET is_super = ? WHERE id = ?",
                            (expected_super, row["id"]),
                        )
                    break
            else:
                # Le numéro prédéfini n'existe pas encore : on l'insère
                try:
                    conn.execute(
                        "INSERT INTO admin_phones (phone, is_super, created_at, added_by) VALUES (?,?,?,?)",
                        (target, expected_super, now_iso(), "system"),
                    )
                except sqlite3.IntegrityError:
                    pass

    if conn.execute("SELECT COUNT(*) FROM books").fetchone()[0] == 0:
        books = [
            ("L'Alchimiste", "Paulo Coelho", "Roman", 4500, "Un berger andalou part à la recherche d'un trésor au pied des pyramides d'Égypte.", "https://covers.openlibrary.org/b/id/8739161-L.jpg", 15, 1, "Best-seller international"),
            ("Le Petit Prince", "Antoine de Saint-Exupéry", "Jeunesse", 3500, "Un conte philosophique et poétique sous l'apparence d'un conte pour enfants.", "https://covers.openlibrary.org/b/id/8226191-L.jpg", 20, 1, "Lecture scolaire et familiale"),
            ("Sapiens", "Yuval Noah Harari", "Sciences", 6500, "Une brève histoire de l'humanité, de la préhistoire à nos jours.", "https://covers.openlibrary.org/b/id/8739173-L.jpg", 8, 1, "Essai historique"),
            ("1984", "George Orwell", "Roman", 4000, "Dans un État totalitaire, Big Brother surveille chaque citoyen.", "https://covers.openlibrary.org/b/id/7222246-L.jpg", 12, 0, "Classique dystopique"),
            ("Les Misérables", "Victor Hugo", "Roman", 5500, "L'épopée de Jean Valjean dans la France du XIXe siècle.", "https://covers.openlibrary.org/b/id/2423902-L.jpg", 6, 0, "Grand classique"),
            ("Thinking, Fast and Slow", "Daniel Kahneman", "Développement", 5000, "Deux systèmes de pensée qui guident nos jugements et décisions.", "https://covers.openlibrary.org/b/id/8171393-L.jpg", 9, 1, "Psychologie cognitive"),
            ("Atomic Habits", "James Clear", "Développement", 4800, "Comment construire de bonnes habitudes et en finir avec les mauvaises.", "https://covers.openlibrary.org/b/id/10309902-L.jpg", 14, 0, "Développement personnel"),
            ("Dune", "Frank Herbert", "Science-Fiction", 5200, "Une fresque épique sur la planète désert Arrakis et son précieux épice.", "https://covers.openlibrary.org/b/id/8087474-L.jpg", 7, 0, "Saga culte"),
            ("Le Comte de Monte-Cristo", "Alexandre Dumas", "Roman", 6000, "La vengeance d'Edmond Dantès, injustement emprisonné au château d'If.", "https://covers.openlibrary.org/b/id/8739051-L.jpg", 5, 1, "Aventure et vengeance"),
            ("Harry Potter à l'école des sorciers", "J.K. Rowling", "Jeunesse", 3800, "Un jeune garçon découvre qu'il est un sorcier et entre à Poudlard.", "https://covers.openlibrary.org/b/id/10110415-L.jpg", 18, 0, "Fantaisie jeunesse"),
            ("Homo Deus", "Yuval Noah Harari", "Sciences", 6000, "Une brève histoire de l'avenir de l'humanité.", "https://covers.openlibrary.org/b/id/8739174-L.jpg", 10, 0, "Prospective"),
            ("La Ferme des Animaux", "George Orwell", "Roman", 3200, "Une fable politique sur la corruption du pouvoir.", "https://covers.openlibrary.org/b/id/8233027-L.jpg", 11, 0, "Satire politique"),
        ]
        conn.executemany(
            """
            INSERT INTO books (titre, auteur, genre, prix, description, image, stock, featured, infos, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            [book + (now_iso(),) for book in books],
        )

    if conn.execute("SELECT COUNT(*) FROM ads").fetchone()[0] == 0:
        conn.execute(
            "INSERT INTO ads (title, message, link, active, created_at) VALUES (?,?,?,?,?)",
            ("Livraison ciblée", "Commandez vos livres dans la zone Potopoto la gare, Saint Exupérie, Présidence, OSH ou CHU.", "", 1, now_iso()),
        )

    conn.execute("UPDATE orders SET status = 'Confirmée' WHERE status IN ('validated', 'confirmed')")
    conn.execute("UPDATE orders SET status = 'Annulée' WHERE status = 'cancelled'")
    conn.execute("UPDATE orders SET status = 'En attente' WHERE status NOT IN ('En attente', 'Confirmée', 'En livraison', 'Livrée', 'Annulée')")
    conn.execute("UPDATE orders SET tracking_token = lower(hex(randomblob(16))) WHERE tracking_token IS NULL OR tracking_token = ''")
    conn.execute("UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''")
    conn.commit()
    conn.close()


def row_to_user(row):
    """Transforme un utilisateur SQLite en dictionnaire public sans hash de mot de passe."""
    if row is None:
        return None
    user = dict(row)
    user.pop("password_hash", None)
    return user


def current_user():
    """Retourne l'utilisateur connecté depuis la session sécurisée Flask.
    Si le compte n'existe plus (supprimé) ou a été désactivé par l'admin,
    la session est vidée pour bloquer tout accès ultérieur."""
    user_id = session.get("user_id")
    if not user_id:
        return None
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if row is None:
        session.pop("user_id", None)
        return None
    if "is_active" in row.keys() and not row["is_active"]:
        session.pop("user_id", None)
        return None
    return row_to_user(row)


def is_authenticated():
    """Indique si la session appartient à un client connecté ou à l'administrateur."""
    return bool(current_user() or require_admin())


def json_required_user():
    """Retourne une réponse JSON si le client doit d'abord se connecter."""
    return jsonify({"error": "Connectez-vous ou créez un compte avant d'accéder au catalogue."}), 401


def require_user_api(func):
    """Protège les endpoints client qui nécessitent un compte actif."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not current_user() and not require_admin():
            return json_required_user()
        return func(*args, **kwargs)
    return wrapper


def require_admin_api(func):
    """Protège les endpoints réservés à l'espace administrateur."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not require_admin():
            return admin_required_response()
        return func(*args, **kwargs)
    return wrapper


def login_user(user_id, remember=True):
    """Ouvre une session client.
    Si remember est vrai, le cookie est persistant (PERMANENT_SESSION_LIFETIME, 7 jours par défaut).
    Sinon, c'est un cookie de session qui expire à la fermeture du navigateur.
    """
    session.clear()
    session.permanent = bool(remember)
    session["user_id"] = int(user_id)
    session["remember"] = bool(remember)
    session.modified = True


def serve_auth_page(message=""):
    """Affiche la page de création de compte et de connexion client sans modifier les fichiers frontend importés."""
    msg = f'<p class="error">{escape(message)}</p>' if message else ""
    return Response(f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{SITE_NAME} — Connexion client</title>
<style>
body{{margin:0;min-height:100vh;background:linear-gradient(135deg,#ff690c,#f59e0b 45%,#2b293a);font-family:Arial,sans-serif;color:#2b293a;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;}}
main{{width:min(980px,100%);background:rgba(255,255,255,.96);border-radius:28px;padding:28px;box-shadow:0 30px 90px rgba(0,0,0,.25);}}
h1{{margin:0 0 8px;font-size:34px;}}
p{{line-height:1.5;}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;margin-top:20px;}}
.card{{background:#fff7ed;border:1px solid #fed7aa;border-radius:20px;padding:20px;}}
input{{width:100%;padding:12px;margin:7px 0;border:1px solid #ddd;border-radius:12px;box-sizing:border-box;}}
button,.link{{display:inline-block;background:#ff690c;color:#fff;border:0;border-radius:999px;padding:12px 18px;text-decoration:none;font-weight:700;cursor:pointer;margin-top:8px;}}
.admin{{background:#2b293a;}}
.error{{background:#fee4e2;color:#b42318;padding:12px;border-radius:12px;}}
.small{{font-size:13px;color:#667085;}}
</style>
</head>
<body>
<main>
<h1>{SITE_NAME}</h1>
<p>Créez un compte ou connectez-vous pour accéder au catalogue, au panier et aux commandes.</p>
{msg}
<div class="grid">
<section class="card">
<h2>Créer un compte</h2>
<form method="post" action="/auth/register">
<input name="name" placeholder="Nom complet" required maxlength="120" autocomplete="name">
<input name="email" type="email" placeholder="Email" required maxlength="180" autocomplete="email">
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
</section>
</div>
<p><a class="link" href="/api/source.zip">Télécharger le code source</a></p>
<p class="small">Session sécurisée : cookie HttpOnly, Secure, SameSite strict, expiration configurable à 7 jours par défaut.</p>
</main>
</body>
</html>""", mimetype="text/html")


def serve_html(filename):
    """Sert les pages HTML importées en conservant le frontend existant et en appliquant les protections serveur."""
    if filename in AUTH_PAGES and is_authenticated():
        return redirect(url_for("index"))
    if filename in PROTECTED_PAGES and not is_authenticated():
        return redirect(url_for("html_page", filename="login"))
    filepath = os.path.join(PUBLIC_HTML, filename)
    if not os.path.exists(filepath):
        return Response("Page non trouvée", status=404)
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    page_key = filename.replace(".html", "")
    new_title = PAGE_TITLES.get(page_key, SITE_NAME)
    content = re.sub(r"<title>[^<]*</title>", f"<title>{new_title}</title>", content, count=1)
    content = re.sub(r"(>)([^<]*)Mayombe([^<]*<)", lambda m: m.group(1) + m.group(2) + SITE_NAME + m.group(3), content)
    if "window.clWDUtil" not in content:
        content = content.replace("</head>", HEAD_COMPAT_SCRIPT, 1)
    if "magma-fixes.css" not in content:
        content = content.replace("</head>", '<link rel="stylesheet" type="text/css" href="/magma-fixes.css"></head>', 1)
    if "/js/bookstore.js" not in content:
        content = content.replace("</body>", INJECT_SCRIPT, 1)
    return Response(content, mimetype="text/html")


def get_admin_phone_entry(phone):
    """Retourne l'entrée admin_phones correspondant à un numéro, comparaison sur les chiffres uniquement."""
    norm = normalize_phone(phone)
    if not norm:
        return None
    conn = get_db()
    rows = conn.execute("SELECT * FROM admin_phones").fetchall()
    conn.close()
    for row in rows:
        if normalize_phone(row["phone"]) == norm:
            return dict(row)
    return None


def current_user_admin_entry():
    """Retourne l'entrée admin_phones de l'utilisateur connecté si son numéro y figure."""
    user = current_user()
    if not user:
        return None
    return get_admin_phone_entry(user.get("phone"))


def require_admin():
    """Vérifie la session administrateur (mot de passe ou numéro de téléphone admin)."""
    if session.get("admin_authenticated"):
        return True
    return current_user_admin_entry() is not None


def admin_role():
    """Retourne le rôle admin courant : 'super', 'normal' ou None."""
    if session.get("admin_authenticated"):
        return session.get("admin_role") or "normal"
    entry = current_user_admin_entry()
    if entry:
        return "super" if entry.get("is_super") else "normal"
    return None


def admin_required_response():
    """Réponse JSON standard pour les accès admin refusés."""
    return jsonify({"error": "Accès administrateur requis."}), 401


def row_to_book(row):
    """Transforme un livre SQLite en dictionnaire API avec types numériques fiables."""
    book = dict(row)
    book["prix"] = int(book.get("prix") or 0)
    book["stock"] = int(book.get("stock") or 0)
    book["featured"] = int(book.get("featured") or 0)
    return book


def row_to_order(row, items=None):
    """Transforme une commande SQLite en réponse API incluant le suivi en temps réel."""
    order = dict(row)
    order["items"] = items or []
    order["can_cancel"] = order["status"] in {"En attente", "Confirmée"} and datetime.utcnow() <= parse_iso(order["created_at"]) + timedelta(minutes=CANCEL_WINDOW_MINUTES)
    order["tracking_steps"] = ORDER_STATUSES[:-1]
    return order


def current_cart():
    """Lit le panier stocké dans la session client."""
    return session.get("cart", [])


def save_cart(cart):
    """Sauvegarde le panier dans la session sécurisée."""
    session["cart"] = cart
    session.modified = True


def send_order_email(order, items):
    """Envoie l'email de commande au destinataire configuré si un serveur SMTP est disponible."""
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_password = os.environ.get("SMTP_PASSWORD")
    smtp_from = os.environ.get("SMTP_FROM", smtp_user or "no-reply@librairie-magma.local")

    lines = [
        f"Nouvelle commande #{order['id']}",
        f"Statut : {order['status']}",
        f"Client : {order['customer_name']}",
        f"Email : {order['customer_email']}",
        f"Téléphone : {order['customer_phone']}",
        f"Zone : {order['delivery_zone']}",
        f"Adresse : {order['delivery_address']}",
        f"Suivi : /api/orders/{order['id']}?token={order['tracking_token']}",
        "",
        "Produits :",
    ]
    for item in items:
        lines.append(f"- {item['titre']} ({item['auteur']}) x{item['qty']} : {item['prix'] * item['qty']} FCFA")
    lines.append("")
    lines.append(f"Total : {order['total']} FCFA")

    if not smtp_host:
        app.logger.warning("SMTP_HOST is not configured; order email was not sent.")
        return "smtp_not_configured"

    message = EmailMessage()
    message["Subject"] = f"Commande Librairie Magma #{order['id']}"
    message["From"] = smtp_from
    message["To"] = ORDER_EMAIL_TO
    message.set_content("\n".join(lines))

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp:
            smtp.starttls()
            if smtp_user and smtp_password:
                smtp.login(smtp_user, smtp_password)
            smtp.send_message(message)
        return "sent"
    except Exception as exc:
        app.logger.exception("Unable to send order email: %s", exc)
        return "failed"


def generate_receipt_pdf(order, items):
    """Génère le reçu PDF téléchargeable pour une commande."""
    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, title=f"Reçu commande {order['id']}")
    styles = getSampleStyleSheet()
    story = [
        Paragraph("Librairie Magma", styles["Title"]),
        Paragraph(f"Reçu de commande #{order['id']}", styles["Heading2"]),
        Paragraph(f"Statut : {escape(order['status'])}", styles["Normal"]),
        Paragraph(f"Date : {order['created_at']}", styles["Normal"]),
        Spacer(1, 12),
        Paragraph("Client", styles["Heading3"]),
        Paragraph(escape(order["customer_name"]), styles["Normal"]),
        Paragraph(escape(order["customer_email"]), styles["Normal"]),
        Paragraph(escape(order["customer_phone"]), styles["Normal"]),
        Paragraph(f"Livraison : {escape(order['delivery_zone'])} — {escape(order['delivery_address'])}", styles["Normal"]),
        Spacer(1, 12),
    ]
    rows = [["Livre", "Auteur", "Qté", "Prix", "Sous-total"]]
    for item in items:
        rows.append([item["titre"], item["auteur"], str(item["qty"]), f"{item['prix']} FCFA", f"{item['prix'] * item['qty']} FCFA"])
    rows.append(["", "", "", "Total", f"{order['total']} FCFA"])
    table = Table(rows, colWidths=[150, 120, 40, 80, 90])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2b293a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#dddddd")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#fff2e8")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ]))
    story.append(table)
    story.append(Spacer(1, 12))
    story.append(Paragraph("Annulation possible uniquement dans les 5 minutes suivant la validation.", styles["Italic"]))
    document.build(story)
    buffer.seek(0)
    return buffer


def user_can_access_order(order):
    """Contrôle qu'une commande appartient au client connecté ou dispose du jeton de suivi."""
    if require_admin():
        return True
    user = current_user()
    token = request.args.get("token") or request.form.get("token")
    if token and secrets.compare_digest(str(token), str(order["tracking_token"] or "")):
        return True
    return bool(user and order["user_id"] and int(order["user_id"]) == int(user["id"]))


@app.route("/")
def index():
    """Page d'accueil : vitrine pour les visiteurs, Accueil-v2 pour les comptes connectés."""
    if is_authenticated():
        return serve_html("Accueil-v2.html")
    return serve_html("vitrine.html")


@app.route("/favicon.ico")
def favicon():
    """Évite les erreurs navigateur pour l'icône du site quand aucun favicon importé n'existe."""
    return Response("", status=204)


@app.route("/auth/register", methods=["POST"])
def auth_register():
    """Crée un compte client avec mot de passe hashé puis connecte l'utilisateur."""
    data = request.get_json(silent=True) or request.form
    try:
        name = clean_text(data.get("name") or data.get("username"), 120, True)
        email = clean_email(data.get("email"))
        password = clean_password(data.get("password"))
        phone_raw = data.get("phone") or data.get("telephone") or ""
        if not str(phone_raw).strip():
            raise ValueError("Le numéro de téléphone est obligatoire pour créer un compte.")
        clean_phone(phone_raw)  # validation du caractère légal des entrées
        phone_digits = normalize_phone(phone_raw)
        if len(phone_digits) != 9:
            raise ValueError("Le numéro doit comporter 9 chiffres au format 06-548-7909.")
        phone = format_phone(phone_digits)
    except ValueError as exc:
        if request.is_json:
            return jsonify({"error": str(exc)}), 400
        return serve_auth_page(str(exc)), 400
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (name, email, phone, password_hash, created_at) VALUES (?,?,?,?,?)",
            (name, email, phone, generate_password_hash(password), now_iso()),
        )
        conn.commit()
        user_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    except sqlite3.IntegrityError:
        conn.close()
        message = "Un compte existe déjà avec cet email. Connectez-vous directement."
        if request.is_json:
            return jsonify({"error": message}), 409
        return serve_auth_page(message), 409
    conn.close()
    login_user(user_id)
    if request.is_json:
        return jsonify({"success": True, "user": current_user()}), 201
    return redirect(url_for("index"))


@app.route("/auth/login", methods=["POST"])
def auth_login():
    """Connecte un client existant après vérification du hash de mot de passe."""
    data = request.get_json(silent=True) or request.form
    identifier = str(data.get("email") or data.get("username") or data.get("identifier") or "").strip()
    password = str(data.get("password") or "")
    if not identifier:
        message = "Veuillez saisir votre email ou nom d'utilisateur."
        if request.is_json:
            return jsonify({"error": message}), 400
        return serve_auth_page(message), 400
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(?) OR LOWER(TRIM(name)) = LOWER(?)",
        (identifier, identifier),
    ).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        conn.close()
        message = "Identifiant ou mot de passe incorrect."
        if request.is_json:
            return jsonify({"error": message}), 401
        return serve_auth_page(message), 401
    if "is_active" in row.keys() and not row["is_active"]:
        conn.close()
        message = "Ce compte a été désactivé. Contactez l'administrateur."
        if request.is_json:
            return jsonify({"error": message}), 403
        return serve_auth_page(message), 403
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_iso(), row["id"]))
    conn.commit()
    conn.close()
    remember_value = data.get("remember") if hasattr(data, "get") else None
    if isinstance(remember_value, str):
        remember_flag = remember_value.lower() in ("1", "true", "yes", "on")
    else:
        remember_flag = bool(remember_value) if remember_value is not None else False
    login_user(row["id"], remember=remember_flag)
    if request.is_json:
        return jsonify({"success": True, "user": current_user(), "remember": remember_flag})
    return redirect(url_for("index"))


@app.route("/auth/logout", methods=["POST", "GET"])
def auth_logout():
    """Ferme la session client ou administrateur. Redirige vers la vitrine après déconnexion."""
    session.clear()
    if request.is_json:
        return jsonify({"success": True, "redirect": "/"})
    return redirect(url_for("index"))


@app.route("/api/auth/status", methods=["GET"])
def auth_status():
    """Retourne l'état de connexion client/admin."""
    return jsonify({"authenticated": is_authenticated(), "user": current_user(), "admin": require_admin()})


@app.route("/api/auth/register", methods=["POST"])
def api_auth_register():
    """Alias JSON de création de compte client."""
    return auth_register()


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    """Alias JSON de connexion client."""
    return auth_login()


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    """Alias JSON de déconnexion."""
    return auth_logout()


@app.route("/api/auth/forgot-password", methods=["POST"])
def api_auth_forgot_password():
    """Vérifie l'identité du client (nom + téléphone + email) puis génère un lien
    de réinitialisation valable 30 minutes. Le téléphone est comparé sur les
    chiffres uniquement pour rester compatible avec le format 06-548-7909."""
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    phone_raw = str(data.get("phone") or "").strip()
    email_raw = str(data.get("email") or "").strip()
    if not name or not phone_raw or not email_raw:
        return jsonify({"error": "Nom, numéro de téléphone et email sont obligatoires."}), 400
    try:
        email = clean_email(email_raw)
    except ValueError:
        return jsonify({"error": "Email invalide."}), 400
    phone_digits = normalize_phone(phone_raw)
    if len(phone_digits) != 9:
        return jsonify({"error": "Le numéro doit comporter 9 chiffres (ex: 06-548-7909)."}), 400
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(?) AND LOWER(TRIM(name)) = LOWER(?)",
        (email, name),
    ).fetchone()
    if row is None or normalize_phone(row["phone"] or "") != phone_digits:
        conn.close()
        return jsonify({"error": "Aucun compte ne correspond à ces trois informations."}), 404
    if "is_active" in row.keys() and not row["is_active"]:
        conn.close()
        return jsonify({"error": "Ce compte a été désactivé. Contactez l'administrateur."}), 403
    token = secrets.token_urlsafe(32)
    created = now_iso()
    expires = (datetime.utcnow() + timedelta(minutes=30)).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO password_resets (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
        (token, row["id"], created, expires),
    )
    conn.commit()
    conn.close()
    reset_link = url_for("html_page", filename="reset-password", _external=True) + "?token=" + token
    return jsonify({
        "message": "Identité confirmée. Cliquez sur le lien ci-dessous pour définir un nouveau mot de passe (valable 30 minutes).",
        "resetLink": reset_link,
    })


@app.route("/api/auth/reset-password", methods=["POST"])
def api_auth_reset_password():
    """Consomme un jeton de réinitialisation et met à jour le mot de passe."""
    data = request.get_json(silent=True) or {}
    token = str(data.get("token") or "").strip()
    new_password = data.get("password")
    if not token:
        return jsonify({"error": "Lien de réinitialisation manquant."}), 400
    try:
        password = clean_password(new_password)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    conn = get_db()
    reset = conn.execute("SELECT * FROM password_resets WHERE token = ?", (token,)).fetchone()
    if reset is None:
        conn.close()
        return jsonify({"error": "Lien invalide ou déjà utilisé."}), 400
    if reset["used_at"]:
        conn.close()
        return jsonify({"error": "Ce lien a déjà été utilisé. Faites une nouvelle demande."}), 400
    try:
        expires = datetime.fromisoformat(reset["expires_at"])
    except (TypeError, ValueError):
        expires = datetime.utcnow() - timedelta(minutes=1)
    if expires < datetime.utcnow():
        conn.close()
        return jsonify({"error": "Lien expiré. Faites une nouvelle demande."}), 400
    conn.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (generate_password_hash(password), reset["user_id"]),
    )
    conn.execute("UPDATE password_resets SET used_at = ? WHERE token = ?", (now_iso(), token))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Mot de passe mis à jour. Vous pouvez maintenant vous connecter."})


@app.route("/<path:filename>.html")
def html_page(filename):
    """Route générique pour servir les pages HTML importées."""
    return serve_html(filename + ".html")


@app.route("/<filename>.css")
def css_file(filename):
    """Sert les feuilles de style importées sans modification."""
    return send_from_directory(PUBLIC_CSS, filename + ".css")


@app.route("/ext/<path:filename>")
def ext_file(filename):
    """Sert les images historiques référencées par les pages WebDev importées."""
    return send_from_directory(PUBLIC_IMG, filename)


@app.route("/img/<path:filename>")
def img_file(filename):
    """Sert les images du catalogue et des pages importées."""
    return send_from_directory(PUBLIC_IMG, filename)


@app.route("/js/<path:filename>")
def js_file(filename):
    """Sert les scripts frontend existants sans modification."""
    return send_from_directory(PUBLIC_JS, filename)


@app.route("/res/<path:filename>")
def res_file(filename):
    """Sert les ressources WebDev nécessaires et neutralise les scripts manquants."""
    res_dir = os.path.join(PUBLIC_HTML, "res")
    if os.path.exists(os.path.join(res_dir, filename)):
        return send_from_directory(res_dir, filename)
    if filename.endswith(".js"):
        return Response("", mimetype="application/javascript")
    return Response("", status=404)


@app.route("/api/books", methods=["GET"])
def get_books():
    """Liste les livres du catalogue avec recherche et filtre par catégorie."""
    genre = clean_text(request.args.get("genre", ""), 80)
    search = clean_text(request.args.get("search", ""), 120)
    conn = get_db()
    query = "SELECT * FROM books WHERE 1=1"
    params = []
    if genre:
        query += " AND genre = ?"
        params.append(genre)
    if search:
        query += " AND (titre LIKE ? OR auteur LIKE ? OR genre LIKE ? OR description LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s, s])
    query += " ORDER BY featured DESC, id DESC"
    books = [row_to_book(row) for row in conn.execute(query, params).fetchall()]
    conn.close()
    return jsonify(books)


@app.route("/api/books/featured", methods=["GET"])
def get_featured():
    """Liste les livres mis en avant pour la page d'accueil."""
    conn = get_db()
    books = [row_to_book(row) for row in conn.execute("SELECT * FROM books WHERE featured = 1 ORDER BY id DESC").fetchall()]
    conn.close()
    return jsonify(books)


@app.route("/api/books/<int:book_id>", methods=["GET"])
def get_book(book_id):
    """Retourne le détail d'un livre."""
    conn = get_db()
    row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    conn.close()
    if row is None:
        return jsonify({"error": "Livre non trouvé"}), 404
    return jsonify(row_to_book(row))


@app.route("/api/books", methods=["POST"])
@require_admin_api
def add_book():
    """Ajoute un livre depuis l'espace administrateur."""
    data = request.get_json(silent=True) or {}
    try:
        titre = clean_text(data.get("titre"), 160, True)
        auteur = clean_text(data.get("auteur"), 160, True)
        genre = clean_text(data.get("genre"), 80, True)
        prix = clean_int(data.get("prix"), 1)
        if prix <= 0:
            raise ValueError("Prix invalide")
        image = clean_url(data.get("image"), 700)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    conn = get_db()
    conn.execute(
        """
        INSERT INTO books (titre, auteur, genre, prix, description, image, stock, featured, infos, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        """,
        (titre, auteur, genre, prix, clean_text(data.get("description"), 1200), image, clean_int(data.get("stock"), 0, 10), 1 if data.get("featured") else 0, clean_text(data.get("infos"), 1000), now_iso()),
    )
    conn.commit()
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    book = row_to_book(conn.execute("SELECT * FROM books WHERE id = ?", (new_id,)).fetchone())
    conn.close()
    return jsonify(book), 201


@app.route("/api/books/<int:book_id>", methods=["PUT"])
@require_admin_api
def update_book(book_id):
    """Modifie un livre existant depuis l'espace administrateur."""
    data = request.get_json(silent=True) or {}
    try:
        titre = clean_text(data.get("titre"), 160, True)
        auteur = clean_text(data.get("auteur"), 160, True)
        genre = clean_text(data.get("genre"), 80, True)
        prix = clean_int(data.get("prix"), 1)
        if prix <= 0:
            raise ValueError("Prix invalide")
        image = clean_url(data.get("image"), 700)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    conn = get_db()
    result = conn.execute(
        """
        UPDATE books
        SET titre = ?, auteur = ?, genre = ?, prix = ?, description = ?, image = ?, stock = ?, featured = ?, infos = ?
        WHERE id = ?
        """,
        (titre, auteur, genre, prix, clean_text(data.get("description"), 1200), image, clean_int(data.get("stock"), 0, 10), 1 if data.get("featured") else 0, clean_text(data.get("infos"), 1000), book_id),
    )
    conn.commit()
    if result.rowcount == 0:
        conn.close()
        return jsonify({"error": "Livre non trouvé"}), 404
    book = row_to_book(conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone())
    conn.close()
    return jsonify(book)


@app.route("/api/books/<int:book_id>", methods=["DELETE"])
@require_admin_api
def delete_book(book_id):
    """Supprime un livre depuis l'espace administrateur."""
    conn = get_db()
    conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/cart", methods=["GET"])
@require_user_api
def get_cart():
    """Retourne le panier du client connecté."""
    return jsonify(current_cart())


@app.route("/api/cart/add", methods=["POST"])
@require_user_api
def add_to_cart():
    """Ajoute un livre disponible au panier."""
    data = request.get_json(silent=True) or {}
    book_id = clean_int(data.get("id"), 1)
    qty = clean_int(data.get("qty"), 1, 1)
    conn = get_db()
    row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    conn.close()
    if row is None:
        return jsonify({"error": "Livre non trouvé"}), 404
    book = row_to_book(row)
    if book["stock"] <= 0:
        return jsonify({"error": "Livre indisponible"}), 400
    cart = current_cart()
    for item in cart:
        if item["id"] == book_id:
            item["qty"] = min(item["qty"] + qty, book["stock"])
            save_cart(cart)
            return jsonify({"success": True, "cart": cart})
    cart.append({"id": book_id, "titre": book["titre"], "auteur": book["auteur"], "prix": book["prix"], "image": book["image"], "qty": min(qty, book["stock"])})
    save_cart(cart)
    return jsonify({"success": True, "cart": cart})


@app.route("/api/cart/remove/<int:book_id>", methods=["DELETE"])
@require_user_api
def remove_from_cart(book_id):
    """Retire un livre du panier."""
    cart = [item for item in current_cart() if item["id"] != book_id]
    save_cart(cart)
    return jsonify({"success": True, "cart": cart})


@app.route("/api/cart/clear", methods=["DELETE"])
@require_user_api
def clear_cart():
    """Vide le panier client."""
    save_cart([])
    return jsonify({"success": True})


@app.route("/api/cart/update", methods=["POST"])
@require_user_api
def update_cart_item():
    """Met à jour la quantité d'un livre dans le panier (respecte le stock)."""
    data = request.get_json(silent=True) or {}
    book_id = clean_int(data.get("id"), 1)
    qty = clean_int(data.get("qty"), 1, 0)
    cart = current_cart()
    if qty <= 0:
        cart = [item for item in cart if item["id"] != book_id]
        save_cart(cart)
        return jsonify({"success": True, "cart": cart})
    conn = get_db()
    row = conn.execute("SELECT stock FROM books WHERE id = ?", (book_id,)).fetchone()
    conn.close()
    if row is None:
        return jsonify({"error": "Livre non trouvé"}), 404
    max_stock = int(row["stock"])
    final_qty = min(qty, max_stock) if max_stock > 0 else 0
    found = False
    for item in cart:
        if item["id"] == book_id:
            item["qty"] = final_qty
            found = True
            break
    if not found:
        return jsonify({"error": "Article absent du panier"}), 404
    if final_qty <= 0:
        cart = [item for item in cart if item["id"] != book_id]
    save_cart(cart)
    return jsonify({"success": True, "cart": cart, "max_stock": max_stock})


@app.route("/api/my-orders", methods=["GET"])
@require_user_api
def my_orders():
    """Liste les commandes de l'utilisateur connecté, plus récentes en premier."""
    user = current_user()
    if not user:
        return jsonify([])
    conn = get_db()
    rows = conn.execute("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", (user["id"],)).fetchall()
    orders = []
    for row in rows:
        items = [dict(item) for item in conn.execute("SELECT * FROM order_items WHERE order_id = ?", (row["id"],)).fetchall()]
        orders.append(row_to_order(row, items))
    conn.close()
    return jsonify(orders)


@app.route("/api/genres", methods=["GET"])
def get_genres():
    """Liste les catégories disponibles dans le catalogue."""
    conn = get_db()
    genres = [row[0] for row in conn.execute("SELECT DISTINCT genre FROM books ORDER BY genre").fetchall()]
    conn.close()
    return jsonify(genres)


@app.route("/api/delivery-zones", methods=["GET"])
@require_user_api
def get_delivery_zones():
    """Retourne les zones de livraison autorisées."""
    return jsonify(ALLOWED_DELIVERY_ZONES)


@app.route("/api/orders", methods=["POST"])
@require_user_api
def create_order():
    """Crée une commande, bloque les zones hors livraison, envoie l'email et prépare le reçu PDF."""
    cart = current_cart()
    if not cart:
        return jsonify({"error": "Votre panier est vide."}), 400
    data = request.get_json(silent=True) or {}
    user = current_user()
    try:
        customer_name = clean_text(data.get("customer_name") or (user or {}).get("name"), 140, True)
        customer_email = clean_email(data.get("customer_email") or (user or {}).get("email"))
        customer_phone = clean_phone(data.get("customer_phone"))
        delivery_zone = clean_text(data.get("delivery_zone"), 120, True)
        delivery_address = clean_text(data.get("delivery_address"), 260, True)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if delivery_zone not in ALLOWED_DELIVERY_ZONES:
        return jsonify({"error": "Livraison impossible : cette adresse est hors zone. Zones autorisées : Potopoto la gare, Total vers Saint Exupérie, Présidence, OSH, CHU."}), 400

    conn = get_db()
    valid_items = []
    total = 0
    for item in cart:
        row = conn.execute("SELECT * FROM books WHERE id = ?", (item["id"],)).fetchone()
        if not row:
            conn.close()
            return jsonify({"error": f"Le livre {item['titre']} n'est plus disponible."}), 400
        book = row_to_book(row)
        qty = min(clean_int(item.get("qty"), 1, 1), book["stock"])
        if qty <= 0:
            conn.close()
            return jsonify({"error": f"Le livre {book['titre']} est en rupture de stock."}), 400
        valid_items.append({"book_id": book["id"], "titre": book["titre"], "auteur": book["auteur"], "prix": book["prix"], "qty": qty, "image": book["image"]})
        total += book["prix"] * qty

    created_at = now_iso()
    tracking_token = secrets.token_urlsafe(24)
    conn.execute(
        """
        INSERT INTO orders (user_id, customer_name, customer_email, customer_phone, delivery_zone, delivery_address, total, status, email_status, tracking_token, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        ((user or {}).get("id"), customer_name, customer_email, customer_phone, delivery_zone, delivery_address, total, "En attente", "pending", tracking_token, created_at, created_at),
    )
    order_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    if user and not (user.get("phone") or "").strip() and customer_phone:
        conn.execute("UPDATE users SET phone = ? WHERE id = ?", (customer_phone, user["id"]))
    for item in valid_items:
        conn.execute(
            "INSERT INTO order_items (order_id, book_id, titre, auteur, prix, qty, image) VALUES (?,?,?,?,?,?,?)",
            (order_id, item["book_id"], item["titre"], item["auteur"], item["prix"], item["qty"], item["image"]),
        )
        conn.execute("UPDATE books SET stock = MAX(stock - ?, 0) WHERE id = ?", (item["qty"], item["book_id"]))
    conn.commit()
    order = dict(conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone())
    email_status = send_order_email(order, valid_items)
    conn.execute("UPDATE orders SET email_status = ? WHERE id = ?", (email_status, order_id))
    conn.commit()
    order = dict(conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone())
    conn.close()
    save_cart([])
    return jsonify({"success": True, "order": order, "receipt_url": f"/api/orders/{order_id}/receipt.pdf", "tracking_url": f"/api/orders/{order_id}?token={tracking_token}", "cancel_until": (parse_iso(created_at) + timedelta(minutes=CANCEL_WINDOW_MINUTES)).isoformat(timespec="seconds")}), 201


@app.route("/api/orders/<int:order_id>", methods=["GET"])
def get_order(order_id):
    """Retourne le suivi temps réel d'une commande avec contrôle propriétaire ou jeton."""
    conn = get_db()
    order = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not order:
        conn.close()
        return jsonify({"error": "Commande non trouvée"}), 404
    if not user_can_access_order(order):
        conn.close()
        return jsonify({"error": "Accès à cette commande refusé."}), 403
    items = [dict(row) for row in conn.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall()]
    conn.close()
    return jsonify(row_to_order(order, items))


@app.route("/api/orders/<int:order_id>/cancel", methods=["POST"])
def cancel_order(order_id):
    """Annule une commande dans les 5 minutes et restaure les stocks."""
    conn = get_db()
    order = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not order:
        conn.close()
        return jsonify({"error": "Commande non trouvée"}), 404
    if not user_can_access_order(order):
        conn.close()
        return jsonify({"error": "Accès à cette commande refusé."}), 403
    order_data = dict(order)
    if order_data["status"] == "Annulée":
        conn.close()
        return jsonify({"error": "Cette commande est déjà annulée."}), 400
    if datetime.utcnow() > parse_iso(order_data["created_at"]) + timedelta(minutes=CANCEL_WINDOW_MINUTES):
        conn.close()
        return jsonify({"error": "Le délai d'annulation de 5 minutes est dépassé."}), 400
    items = conn.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall()
    for item in items:
        if item["book_id"]:
            conn.execute("UPDATE books SET stock = stock + ? WHERE id = ?", (item["qty"], item["book_id"]))
    conn.execute("UPDATE orders SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?", ("Annulée", now_iso(), now_iso(), order_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "status": "Annulée"})


@app.route("/api/orders/<int:order_id>/receipt.pdf", methods=["GET"])
def download_receipt(order_id):
    """Télécharge le reçu PDF d'une commande autorisée."""
    conn = get_db()
    order = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not order:
        conn.close()
        return jsonify({"error": "Commande non trouvée"}), 404
    if not user_can_access_order(order):
        conn.close()
        return jsonify({"error": "Accès à cette commande refusé."}), 403
    items = [dict(row) for row in conn.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall()]
    conn.close()
    pdf = generate_receipt_pdf(dict(order), items)
    return send_file(pdf, mimetype="application/pdf", as_attachment=True, download_name=f"recu-commande-{order_id}.pdf")


@app.route("/api/reviews", methods=["POST"])
@require_user_api
def add_review():
    """Ajoute un avis client noté de 1 à 5 étoiles."""
    data = request.get_json(silent=True) or {}
    book_id = clean_int(data.get("book_id"), 1)
    rating = min(clean_int(data.get("rating"), 1, 5), 5)
    user = current_user()
    try:
        customer_name = clean_text(data.get("customer_name") or (user or {}).get("name"), 120, True)
        comment = clean_text(data.get("comment"), 800, True)
    except ValueError:
        return jsonify({"error": "Nom et commentaire obligatoires."}), 400
    conn = get_db()
    if not conn.execute("SELECT id FROM books WHERE id = ?", (book_id,)).fetchone():
        conn.close()
        return jsonify({"error": "Livre non trouvé"}), 404
    conn.execute("INSERT INTO reviews (book_id, user_id, customer_name, rating, comment, created_at) VALUES (?,?,?,?,?,?)", (book_id, (user or {}).get("id"), customer_name, rating, comment, now_iso()))
    conn.commit()
    review = dict(conn.execute("SELECT * FROM reviews WHERE id = last_insert_rowid()").fetchone())
    conn.close()
    return jsonify(review), 201


@app.route("/api/books/<int:book_id>/reviews", methods=["GET"])
def get_reviews(book_id):
    """Liste les avis clients d'un livre."""
    conn = get_db()
    reviews = [dict(row) for row in conn.execute("SELECT * FROM reviews WHERE book_id = ? ORDER BY id DESC", (book_id,)).fetchall()]
    conn.close()
    return jsonify(reviews)


@app.route("/api/books/<int:book_id>/reviews", methods=["POST"])
@require_user_api
def post_book_review(book_id):
    """Ajoute un avis sur un livre. L'auteur est le compte connecté."""
    data = request.get_json(silent=True) or {}
    rating = max(1, min(clean_int(data.get("rating"), 1, 5), 5))
    user = current_user() or {}
    try:
        comment = clean_text(data.get("comment"), 800, True)
    except ValueError:
        return jsonify({"error": "Le commentaire est obligatoire."}), 400
    if len(comment) < 3:
        return jsonify({"error": "Votre commentaire est trop court."}), 400
    customer_name = (data.get("author") or user.get("name") or "Client").strip()[:120]
    conn = get_db()
    if not conn.execute("SELECT id FROM books WHERE id = ?", (book_id,)).fetchone():
        conn.close()
        return jsonify({"error": "Livre non trouvé"}), 404
    conn.execute(
        "INSERT INTO reviews (book_id, user_id, customer_name, rating, comment, created_at) VALUES (?,?,?,?,?,?)",
        (book_id, user.get("id"), customer_name, rating, comment, now_iso()),
    )
    conn.commit()
    review = dict(conn.execute("SELECT * FROM reviews WHERE id = last_insert_rowid()").fetchone())
    conn.close()
    return jsonify(review), 201


@app.route("/api/ads", methods=["GET"])
def get_ads():
    """Liste les publicités actives visibles par les visiteurs."""
    conn = get_db()
    ads = [dict(row) for row in conn.execute("SELECT * FROM ads WHERE active = 1 ORDER BY id DESC").fetchall()]
    conn.close()
    return jsonify(ads)


@app.route("/api/admin/status", methods=["GET"])
def admin_status():
    """Retourne l'état de connexion administrateur (mot de passe ou téléphone)."""
    is_admin = require_admin()
    role = admin_role()
    via_phone = False
    if is_admin and not session.get("admin_authenticated"):
        via_phone = True
    return jsonify({
        "authenticated": is_admin,
        "role": role,
        "is_super": role == "super",
        "via_phone": via_phone,
    })


@app.route("/api/admin/phones", methods=["GET"])
@require_admin_api
def admin_list_phones():
    """Liste les numéros de téléphone reconnus comme administrateurs."""
    conn = get_db()
    rows = conn.execute("SELECT * FROM admin_phones ORDER BY is_super DESC, id ASC").fetchall()
    conn.close()
    return jsonify([{
        "id": r["id"],
        "phone": r["phone"],
        "is_super": bool(r["is_super"]),
        "created_at": r["created_at"],
        "added_by": r["added_by"] or "",
    } for r in rows])


@app.route("/api/admin/phones", methods=["POST"])
@require_admin_api
def admin_add_phone():
    """Ajoute un numéro à la liste des admins. Admin et super-admin peuvent ajouter."""
    data = request.get_json(silent=True) or {}
    phone_norm = normalize_phone(data.get("phone"))
    if len(phone_norm) != 9:
        return jsonify({"error": "Le numéro doit comporter 9 chiffres au format 06-548-7909."}), 400
    if get_admin_phone_entry(phone_norm):
        return jsonify({"error": "Ce numéro est déjà admin."}), 409
    is_super = 1 if (data.get("is_super") and admin_role() == "super") else 0
    phone_formatted = format_phone(phone_norm)
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO admin_phones (phone, is_super, created_at, added_by) VALUES (?,?,?,?)",
            (phone_formatted, is_super, now_iso(), (current_user() or {}).get("name") or "admin"),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "Ce numéro est déjà admin."}), 409
    conn.close()
    return jsonify({"success": True, "phone": phone_formatted, "is_super": bool(is_super)}), 201


@app.route("/api/admin/phones/<path:phone>", methods=["DELETE"])
@require_admin_api
def admin_delete_phone(phone):
    """Retire un numéro admin (peu importe le format envoyé). Réservé au super-admin."""
    if admin_role() != "super":
        return jsonify({"error": "Seul un super-admin peut supprimer un numéro admin."}), 403
    entry = get_admin_phone_entry(phone)
    if not entry:
        return jsonify({"error": "Numéro introuvable."}), 404
    conn = get_db()
    conn.execute("DELETE FROM admin_phones WHERE id = ?", (entry["id"],))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    """Connecte l'administrateur avec le mot de passe dédié."""
    data = request.get_json(silent=True) or {}
    password = str(data.get("password") or "")
    if secrets.compare_digest(password, ADMIN_PASSWORD_SUPER):
        session.clear()
        session.permanent = True
        session["admin_authenticated"] = True
        session["admin_role"] = "super"
        return jsonify({"success": True, "role": "super"})
    if secrets.compare_digest(password, ADMIN_PASSWORD):
        session.clear()
        session.permanent = True
        session["admin_authenticated"] = True
        session["admin_role"] = "normal"
        return jsonify({"success": True, "role": "normal"})
    return jsonify({"error": "Mot de passe administrateur incorrect."}), 401


@app.route("/api/admin/logout", methods=["POST"])
def admin_logout():
    """Déconnecte l'administrateur."""
    session.pop("admin_authenticated", None)
    session.pop("admin_role", None)
    return jsonify({"success": True})


def serve_admin_dashboard(role):
    """Sert le tableau de bord admin/super-admin à partir de Admin.html.
    L'accès est strictement réservé aux comptes administrateurs identifiés par téléphone.
    """
    if not is_authenticated():
        # Visiteur anonyme : redirection vers la page de connexion classique.
        return redirect("/login.html")
    if not require_admin():
        # Utilisateur connecté mais sans privilèges : retour à la vitrine/accueil.
        return redirect(url_for("index"))
    current_role = admin_role() or "normal"
    if current_role != role:
        return redirect("/super-admin.html" if current_role == "super" else "/admin.html")
    filepath = os.path.join(PUBLIC_HTML, "Admin.html")
    if not os.path.exists(filepath):
        return Response("Page non trouvée", status=404)
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    title = SITE_NAME + (" — Super Admin" if role == "super" else " — Admin")
    content = re.sub(r"<title>[^<]*</title>", f"<title>{title}</title>", content, count=1)
    content = content.replace('<div id="admin-login-screen">', '<div id="admin-login-screen" style="display:none!important;">')
    content = content.replace('<div id="admin-dashboard">', '<div id="admin-dashboard" style="display:block;">')
    content = content.replace(
        "</head>",
        f'<script>window.MAGMA_ADMIN_ROLE={json.dumps(role)};window.MAGMA_ADMIN_PAGE=true;</script></head>',
        1,
    )
    if "magma-fixes.css" not in content:
        content = content.replace("</head>", '<link rel="stylesheet" type="text/css" href="/magma-fixes.css"></head>', 1)
    if "/js/bookstore.js" not in content:
        content = content.replace("</body>", '<script src="/js/bookstore.js"></script></body>', 1)
    content = content.replace("<body>", f'<body class="admin-page admin-{role}">', 1)
    return Response(content, mimetype="text/html")


@app.route("/admin.html")
def admin_dashboard_normal():
    """Tableau de bord administrateur normal."""
    return serve_admin_dashboard("normal")


@app.route("/super-admin.html")
def admin_dashboard_super():
    """Tableau de bord super-administrateur."""
    return serve_admin_dashboard("super")


@app.route("/Admin.html")
def admin_legacy_redirect():
    """L'ancienne page de connexion admin par mot de passe est supprimée.
    L'accès admin se fait uniquement par téléphone reconnu lors de l'inscription / connexion.
    """
    if is_authenticated() and require_admin():
        role = admin_role() or "normal"
        return redirect("/super-admin.html" if role == "super" else "/admin.html")
    if is_authenticated():
        return redirect(url_for("index"))
    return redirect("/login.html")


@app.route("/api/admin/orders", methods=["GET"])
@require_admin_api
def admin_get_orders():
    """Liste toutes les commandes pour l'espace administrateur."""
    conn = get_db()
    rows = conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
    orders = []
    for row in rows:
        items = [dict(item) for item in conn.execute("SELECT * FROM order_items WHERE order_id = ?", (row["id"],)).fetchall()]
        orders.append(row_to_order(row, items))
    conn.close()
    return jsonify(orders)


@app.route("/api/admin/orders/<int:order_id>/status", methods=["PUT", "POST"])
@require_admin_api
def admin_update_order_status(order_id):
    """Met à jour le statut de suivi d'une commande."""
    data = request.get_json(silent=True) or {}
    status = clean_text(data.get("status"), 40, True)
    if status not in ORDER_STATUSES:
        return jsonify({"error": "Statut invalide. Utilisez : En attente, Confirmée, En livraison, Livrée."}), 400
    conn = get_db()
    result = conn.execute("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", (status, now_iso(), order_id))
    conn.commit()
    if result.rowcount == 0:
        conn.close()
        return jsonify({"error": "Commande non trouvée"}), 404
    order = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    items = [dict(item) for item in conn.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall()]
    conn.close()
    return jsonify(row_to_order(order, items))


@app.route("/api/admin/ads", methods=["GET"])
@require_admin_api
def admin_get_ads():
    """Liste toutes les publicités pour l'espace administrateur."""
    conn = get_db()
    ads = [dict(row) for row in conn.execute("SELECT * FROM ads ORDER BY id DESC").fetchall()]
    conn.close()
    return jsonify(ads)


@app.route("/api/admin/ads", methods=["POST"])
@require_admin_api
def admin_add_ad():
    """Ajoute une publicité depuis l'espace administrateur."""
    data = request.get_json(silent=True) or {}
    try:
        title = clean_text(data.get("title"), 160, True)
        message = clean_text(data.get("message"), 500, True)
        link = clean_url(data.get("link"), 500)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    conn = get_db()
    conn.execute("INSERT INTO ads (title, message, link, active, created_at) VALUES (?,?,?,?,?)", (title, message, link, 1 if data.get("active", True) else 0, now_iso()))
    conn.commit()
    ad = dict(conn.execute("SELECT * FROM ads WHERE id = last_insert_rowid()").fetchone())
    conn.close()
    return jsonify(ad), 201


@app.route("/api/admin/ads/<int:ad_id>", methods=["DELETE"])
@require_admin_api
def admin_delete_ad(ad_id):
    """Supprime une publicité depuis l'espace administrateur."""
    conn = get_db()
    conn.execute("DELETE FROM ads WHERE id = ?", (ad_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/admin/users", methods=["GET"])
@require_admin_api
def admin_list_users():
    """Liste les utilisateurs avec stats commandes pour l'admin."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, email, created_at, last_login_at, "
        "COALESCE(is_active, 1) AS is_active FROM users ORDER BY id DESC"
    ).fetchall()
    users = []
    for r in rows:
        stats = conn.execute(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(total),0) AS total_spent "
            "FROM orders WHERE user_id = ? AND status != 'Annulée'",
            (r["id"],),
        ).fetchone()
        users.append({
            "id": r["id"],
            "name": r["name"],
            "email": r["email"],
            "created_at": r["created_at"],
            "last_login_at": r["last_login_at"],
            "is_active": bool(r["is_active"]),
            "order_count": stats["cnt"] or 0,
            "total_spent": stats["total_spent"] or 0,
        })
    conn.close()
    return jsonify(users)


@app.route("/api/admin/users/<int:user_id>/toggle-status", methods=["PUT", "POST"])
@require_admin_api
def admin_toggle_user_status(user_id):
    """Active ou désactive un compte client."""
    conn = get_db()
    row = conn.execute("SELECT COALESCE(is_active, 1) AS is_active FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Utilisateur introuvable."}), 404
    new_state = 0 if row["is_active"] else 1
    conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (new_state, user_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "is_active": bool(new_state)})


@app.route("/api/admin/users/<int:user_id>", methods=["DELETE"])
@require_admin_api
def admin_delete_user(user_id):
    """Supprime un compte client (les commandes sont conservées sans lien utilisateur)."""
    conn = get_db()
    row = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Utilisateur introuvable."}), 404
    conn.execute("UPDATE orders SET user_id = NULL WHERE user_id = ?", (user_id,))
    conn.execute("UPDATE reviews SET user_id = NULL WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/source.zip", methods=["GET"])
def download_source_zip():
    """Génère un ZIP téléchargeable du code source modifié, sans cache ni base locale."""
    if not is_authenticated():
        return redirect(url_for("html_page", filename="login"))
    excluded_dirs = {".git", ".cache", ".pythonlibs", "__pycache__", ".local/state"}
    excluded_files = {"data/bookstore.db"}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, dirs, files in os.walk(BASE_DIR):
            rel_root = os.path.relpath(root, BASE_DIR)
            dirs[:] = [d for d in dirs if os.path.join(rel_root, d).strip("./") not in excluded_dirs and d not in excluded_dirs]
            for filename in files:
                full_path = os.path.join(root, filename)
                rel_path = os.path.relpath(full_path, BASE_DIR)
                normalized = rel_path.replace(os.sep, "/")
                if normalized in excluded_files or normalized.endswith(".pyc") or normalized.startswith(".cache/") or normalized.startswith(".git/"):
                    continue
                archive.write(full_path, normalized)
    buffer.seek(0)
    return send_file(buffer, mimetype="application/zip", as_attachment=True, download_name="librairie-magma-source.zip")


def _build_source_archive(extra_files=None):
    """Construit un ZIP du code source en excluant les artefacts régénérables."""
    excluded_dirs = {".git", ".cache", ".pythonlibs", "__pycache__", ".local", "node_modules", "attached_assets", ".upm"}
    excluded_files = {"data/bookstore.db"}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, dirs, files in os.walk(BASE_DIR):
            rel_root = os.path.relpath(root, BASE_DIR)
            dirs[:] = [d for d in dirs if d not in excluded_dirs and os.path.join(rel_root, d).replace(os.sep, "/").strip("./") not in excluded_dirs]
            for filename in files:
                full_path = os.path.join(root, filename)
                rel_path = os.path.relpath(full_path, BASE_DIR)
                normalized = rel_path.replace(os.sep, "/")
                if normalized in excluded_files or normalized.endswith(".pyc"):
                    continue
                if any(normalized.startswith(d + "/") for d in excluded_dirs):
                    continue
                archive.write(full_path, normalized)
        existing = set(archive.namelist())
        for name, content in (extra_files or {}).items():
            if name not in existing:
                archive.writestr(name, content)
    buffer.seek(0)
    return buffer


@app.route("/api/source-render.zip", methods=["GET"])
def download_source_render_zip():
    """Télécharge un ZIP prêt pour un déploiement Render (Flask + gunicorn)."""
    if not is_authenticated():
        return redirect(url_for("html_page", filename="login"))
    render_yaml = (
        "services:\n"
        "  - type: web\n"
        "    name: librairie-magma\n"
        "    runtime: python\n"
        "    plan: free\n"
        "    buildCommand: pip install -r requirements.txt\n"
        "    startCommand: gunicorn --bind 0.0.0.0:$PORT main:app\n"
        "    envVars:\n"
        "      - key: PYTHON_VERSION\n"
        "        value: 3.11.0\n"
        "      - key: SESSION_SECRET\n"
        "        generateValue: true\n"
    )
    procfile = "web: gunicorn --bind 0.0.0.0:$PORT main:app\n"
    env_example = (
        "PORT=5000\n"
        "SESSION_SECRET=change-me\n"
        "# SMTP_HOST=\n"
        "# SMTP_PORT=587\n"
        "# SMTP_USER=\n"
        "# SMTP_PASSWORD=\n"
        "# SMTP_FROM=\n"
        "# ORDER_EMAIL=\n"
    )
    requirements = (
        "flask>=3.0\n"
        "gunicorn>=21.2\n"
        "email-validator>=2.0\n"
        "reportlab>=4.0\n"
        "werkzeug>=3.0\n"
    )
    readme = (
        "# Librairie Magma — Déploiement Render\n\n"
        "## Étapes\n"
        "1. Créez un compte sur https://render.com\n"
        "2. New + → Web Service → connectez votre dépôt Git contenant ces fichiers.\n"
        "3. Render lit automatiquement `render.yaml`:\n"
        "   - Runtime: Python 3.11\n"
        "   - Build: `pip install -r requirements.txt`\n"
        "   - Start: `gunicorn --bind 0.0.0.0:$PORT main:app`\n"
        "4. `SESSION_SECRET` est généré automatiquement par Render.\n"
        "5. (optionnel) Ajoutez `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` pour l'envoi d'emails.\n\n"
        "## Note SQLite\n"
        "La base SQLite `data/bookstore.db` est créée au démarrage. Sur le plan gratuit Render le disque est éphémère :\n"
        "ajoutez un Disk dans le dashboard et montez-le sur `/opt/render/project/src/data` pour la persistance.\n"
    )
    extras = {
        "render.yaml": render_yaml,
        "Procfile": procfile,
        ".env.example": env_example,
        "requirements.txt": requirements,
        "RENDER.md": readme,
    }
    buffer = _build_source_archive(extras)
    return send_file(buffer, mimetype="application/zip", as_attachment=True, download_name="librairie-magma-render.zip")


@app.route("/api/source-railway.zip", methods=["GET"])
def download_source_railway_zip():
    """Télécharge un ZIP prêt pour un déploiement Railway."""
    if not is_authenticated():
        return redirect(url_for("html_page", filename="login"))
    procfile = "web: gunicorn --bind 0.0.0.0:$PORT main:app\n"
    railway_json = json.dumps({
        "$schema": "https://railway.app/railway.schema.json",
        "build": {"builder": "NIXPACKS"},
        "deploy": {
            "startCommand": "gunicorn --bind 0.0.0.0:$PORT main:app",
            "restartPolicyType": "ON_FAILURE",
            "restartPolicyMaxRetries": 10,
        },
    }, indent=2) + "\n"
    nixpacks = "[phases.setup]\nnixPkgs = ['python311']\n\n[start]\ncmd = 'gunicorn --bind 0.0.0.0:$PORT main:app'\n"
    env_example = (
        "PORT=5000\n"
        "SESSION_SECRET=change-me\n"
        "# SMTP_HOST=\n"
        "# SMTP_PORT=587\n"
        "# SMTP_USER=\n"
        "# SMTP_PASSWORD=\n"
        "# SMTP_FROM=\n"
        "# ORDER_EMAIL=\n"
    )
    requirements = (
        "flask>=3.0\n"
        "gunicorn>=21.2\n"
        "email-validator>=2.0\n"
        "reportlab>=4.0\n"
        "werkzeug>=3.0\n"
    )
    readme = (
        "# Librairie Magma — Déploiement Railway\n\n"
        "1. Créez un nouveau projet Railway et importez ce dossier.\n"
        "2. Définissez les variables d'environnement (voir `.env.example`).\n"
        "3. Railway détecte Python automatiquement et utilise `gunicorn` comme commande de démarrage.\n"
        "4. L'application écoute sur le port défini par `PORT`.\n"
    )
    extras = {
        "Procfile": procfile,
        "railway.json": railway_json,
        "nixpacks.toml": nixpacks,
        ".env.example": env_example,
        "requirements.txt": requirements,
        "RAILWAY.md": readme,
    }
    buffer = _build_source_archive(extras)
    return send_file(buffer, mimetype="application/zip", as_attachment=True, download_name="librairie-magma-railway.zip")


@app.route("/download-source.zip", methods=["GET"])
def download_source_zip_alias():
    """Alias lisible pour télécharger le code source complet."""
    return download_source_zip()


UPLOADS_DIR = os.path.join(BASE_DIR, "public", "uploads")
COVERS_DIR = os.path.join(UPLOADS_DIR, "covers")
os.makedirs(COVERS_DIR, exist_ok=True)

ALLOWED_COVER_EXT = {"jpg", "jpeg", "png", "webp", "gif"}
MAX_COVER_BYTES = 5 * 1024 * 1024  # 5 Mo


@app.route("/api/admin/upload-cover", methods=["POST"])
@require_admin_api
def upload_cover():
    """Reçoit une image de couverture envoyée depuis l'espace administrateur."""
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "Aucun fichier reçu"}), 400
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_COVER_EXT:
        return jsonify({"error": "Format non autorisé (jpg, png, webp, gif)"}), 400
    file.stream.seek(0, os.SEEK_END)
    size = file.stream.tell()
    file.stream.seek(0)
    if size > MAX_COVER_BYTES:
        return jsonify({"error": "Fichier trop volumineux (max 5 Mo)"}), 400
    name = secrets.token_hex(8) + "." + ext
    file.save(os.path.join(COVERS_DIR, name))
    return jsonify({"url": "/uploads/covers/" + name})


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    """Sert les fichiers téléversés (couvertures de livres, etc.)."""
    fullpath = os.path.join(UPLOADS_DIR, filename)
    if not os.path.exists(fullpath):
        return Response("Fichier non trouvé", status=404)
    return send_from_directory(UPLOADS_DIR, filename)


@app.route("/<path:filename>")
def static_file(filename):
    """Sert les fichiers statiques importés restants après les routes applicatives."""
    for base in [PUBLIC_HTML, PUBLIC_CSS, PUBLIC_IMG, PUBLIC_JS]:
        fullpath = os.path.join(base, filename)
        if os.path.exists(fullpath):
            return send_from_directory(base, filename)
    return Response("Fichier non trouvé", status=404)


init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
