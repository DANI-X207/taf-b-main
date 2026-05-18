require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");

const { initDb } = require("./src/db");
const authRouter = require("./src/routes/auth");
const booksRouter = require("./src/routes/books");
const cartRouter = require("./src/routes/cart");
const { router: ordersRouter } = require("./src/routes/orders");
const reviewsRouter = require("./src/routes/reviews");
const adminRouter = require("./src/routes/admin");
const { router: pagesRouter } = require("./src/routes/pages");

const app = express();

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const isProduction = process.env.NODE_ENV === "production";
const secureCookie = process.env.SESSION_COOKIE_SECURE === "true" || isProduction;
const sessionDays = parseInt(process.env.SESSION_DAYS || "7");

app.use(session({
  name: "magma_sid",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "strict",
    maxAge: sessionDays * 24 * 60 * 60 * 1000,
  },
}));

const PUBLIC_CSS = path.join(__dirname, "public", "css");
const PUBLIC_IMG = path.join(__dirname, "public", "img");
const PUBLIC_JS = path.join(__dirname, "public", "js");
const PUBLIC_HTML = path.join(__dirname, "public", "html");

app.use("/:file.css", (req, res, next) => {
  res.sendFile(req.params.file + ".css", { root: PUBLIC_CSS }, (err) => { if (err) next(); });
});
app.use("/ext", express.static(PUBLIC_IMG));
app.use("/img", express.static(PUBLIC_IMG));
app.use("/js", express.static(PUBLIC_JS));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));
app.use("/res", (req, res, next) => {
  const resDir = path.join(PUBLIC_HTML, "res");
  res.sendFile(req.path, { root: resDir }, (err) => {
    if (err) {
      if (req.path.endsWith(".js")) return res.type("js").send("");
      return res.status(404).end();
    }
  });
});

app.use(authRouter);
app.use(booksRouter);
app.use(cartRouter);
app.use(ordersRouter);
app.use(reviewsRouter);
app.use(adminRouter);
app.use(pagesRouter);

app.use((req, res) => {
  for (const dir of [PUBLIC_HTML, PUBLIC_CSS, PUBLIC_IMG, PUBLIC_JS]) {
    const fp = path.join(dir, req.path);
    const fs = require("fs");
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return res.sendFile(fp);
  }
  res.status(404).send("Fichier non trouvé");
});

const PORT = parseInt(process.env.PORT || "5000");
initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Librairie Magma running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });

module.exports = app;
