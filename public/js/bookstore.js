(function () {
  "use strict";

  window.clWDUtil = window.clWDUtil || {
    pfGetTraitement: function () {
      return function () {};
    }
  };

  function api(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw data;
        return data;
      });
    });
  }

  function get(url) { return api(url); }
  function post(url, data) {
    return api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });
  }
  function put(url, data) {
    return api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });
  }
  function del(url) { return api(url, { method: "DELETE" }); }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(value) {
    return Number(value || 0).toLocaleString("fr-FR") + " FCFA";
  }

  function renderReview(review) {
    return '<p><strong>' + esc(review.customer_name) + '</strong> — ' + '★'.repeat(Number(review.rating) || 0) + '<br>' + esc(review.comment) + '</p>';
  }

  function pageName() {
    var p = window.location.pathname;
    if (p === "/" || p.indexOf("index") !== -1) return "home";
    if (p.indexOf("Mon-panier") !== -1) return "cart";
    if (p.indexOf("Ajout-Produit") !== -1) return "add";
    if (p.indexOf("PI_Produit") !== -1) return "detail";
    if (p.indexOf("MABOUTIQUE") !== -1) return "boutique";
    if (p.indexOf("register") !== -1 || p.indexOf("inscription") !== -1) return "register";
    if (p.indexOf("reset-password") !== -1) return "reset";
    if (p.indexOf("login") !== -1 || p.indexOf("connexion") !== -1) return "login";
    if (p === "/admin.html" || p === "/super-admin.html") return "admin";
    if (p.indexOf("Admin") !== -1) return "admin-login";
    return "other";
  }
  function isAdminAreaPage() {
    var n = pageName();
    return n === "admin" || n === "admin-login";
  }

  function toast(message, type) {
    var box = document.getElementById("magma-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "magma-toast";
      box.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:999999;max-width:360px;padding:13px 16px;border-radius:14px;color:#fff;font-family:Arial,sans-serif;box-shadow:0 18px 45px rgba(0,0,0,.25);opacity:0;transform:translateY(8px);transition:.25s;";
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.style.background = type === "error" ? "#b42318" : "#1f7a4d";
    box.style.opacity = "1";
    box.style.transform = "translateY(0)";
    clearTimeout(box._timer);
    box._timer = setTimeout(function () {
      box.style.opacity = "0";
      box.style.transform = "translateY(8px)";
    }, 3500);
  }

  function addAdminLink() {
    if (document.getElementById("magma-admin-link")) return;
    // Vérifie que l'utilisateur est réellement admin (mot de passe ou téléphone) avant d'afficher l'icône.
    fetch("/api/admin/status", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !s.authenticated) return;
        if (document.getElementById("magma-admin-link")) return;

        var isSuper    = !!s.is_super;
        var label      = isSuper ? "Super Admin" : "Admin";
        var emoji      = isSuper ? "🛡️" : "🛠️";
        var href       = isSuper ? "/super-admin.html" : "/admin.html";
        var badgeColor = isSuper ? "#f59e0b" : "#ff690c";

        // ── Injection keyframes (une seule fois, uniquement pour le bouton flottant) ──
        if (!document.getElementById("magma-admin-pulse-style")) {
          var style = document.createElement("style");
          style.id = "magma-admin-pulse-style";
          style.textContent =
            "@keyframes magma-admin-pulse{" +
              "0%,100%{box-shadow:0 0 0 0 " + badgeColor + "66;}" +
              "50%{box-shadow:0 0 0 7px " + badgeColor + "00;}" +
            "}" +
            "body > #magma-admin-link{animation:magma-admin-pulse 2.4s ease-in-out infinite;}" +
            "#magma-admin-link{transition:transform .2s, opacity .2s;}" +
            "#magma-admin-link:hover{transform:scale(1.04);opacity:1 !important;}" +
            "body > #magma-admin-link .magma-admin-badge{" +
              "position:absolute;top:-8px;right:-6px;" +
              "background:" + badgeColor + ";color:#fff;" +
              "font-size:9px;font-weight:800;" +
              "padding:2px 5px;border-radius:999px;" +
              "letter-spacing:.3px;white-space:nowrap;" +
              "border:1.5px solid #000;" +
              "pointer-events:none;" +
            "}";
          document.head.appendChild(style);
        }

        // ── Cas 1 : pages modernes avec header.topbar (Accueil-v2, catalogue, etc.) ──
        var iconsBar = document.querySelector("header.topbar .icons");
        if (iconsBar) {
          var btn = document.createElement("a");
          btn.id        = "magma-admin-link";
          btn.href      = href;
          btn.title     = "Tableau de bord " + label;
          btn.className = "icon-btn";
          btn.setAttribute("aria-label", "Espace " + label);

          var bgLight = isSuper ? "rgba(245,158,11,0.12)" : "rgba(255,105,12,0.12)";
          var borderLight = isSuper ? "rgba(245,158,11,0.25)" : "rgba(255,105,12,0.25)";

          btn.style.cssText =
            "position:relative;" +
            "background:" + bgLight + ";" +
            "border:1px solid " + borderLight + ";" +
            "border-radius:6px;padding:5px 10px;" +
            "display:inline-flex;align-items:center;gap:6px;" +
            "color:" + badgeColor + ";";

          // Icône SVG élégante et épurée (Shield pour Super Admin, Wrench/Tool pour Admin)
          var svgPath = isSuper
            ? "<path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' stroke-linecap='round' stroke-linejoin='round'/>"
            : "<path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' stroke-linecap='round' stroke-linejoin='round'/>";

          btn.innerHTML =
            "<svg viewBox='0 0 24 24' style='stroke:" + badgeColor + ";fill:none;stroke-width:2;width:18px;height:18px'>" + svgPath + "</svg>" +
            "<span class='lbl' style='color:" + badgeColor + ";font-weight:600;font-size:12px;opacity:1;'>" + label + "</span>";
          iconsBar.appendChild(btn);
          return;
        }

        // ── Cas 2 : pages WEBDEV exportées sans topbar moderne — bouton flottant ──
        var link = document.createElement("a");
        link.id   = "magma-admin-link";
        link.href = href;
        link.title = "Ouvrir le tableau de bord administrateur";
        link.style.cssText =
          "position:fixed;right:18px;bottom:76px;z-index:99999;" +
          "background:" + badgeColor + ";color:#fff;text-decoration:none;" +
          "padding:9px 16px;border-radius:999px;" +
          "font:700 13px Arial,sans-serif;" +
          "box-shadow:0 10px 28px rgba(0,0,0,.25);" +
          "display:flex;align-items:center;gap:6px;";
        link.innerHTML = "<span style='font-size:16px;line-height:1'>" + emoji + "</span>" +
                         "<span>" + label + "</span>" +
                         "<span class='magma-admin-badge'>" + (isSuper ? "SUPER" : "ADMIN") + "</span>";
        document.body.appendChild(link);
      })
      .catch(function () {});
  }

  function updateCartBadge() {
    get("/api/cart").then(function (cart) {
      var count = cart.reduce(function (sum, item) { return sum + Number(item.qty || 0); }, 0);
      var badge = document.getElementById("magma-cart-badge");
      if (!badge) {
        badge = document.createElement("a");
        badge.id = "magma-cart-badge";
        badge.href = "/panier.html";
        badge.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:99999;background:#ff690c;color:#fff;text-decoration:none;padding:9px 14px;border-radius:999px;font:700 13px Arial,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.2);";
        document.body.appendChild(badge);
      }
      badge.textContent = "Panier (" + count + ")";
    }).catch(function () {});
  }

  function bookCard(book) {
    var card = document.createElement("div");
    card.className = "magma-book-card";
    card.innerHTML =
      '<img src="' + esc(book.image || "") + '" alt="' + esc(book.titre) + '" style="width:100%;height:180px;object-fit:cover;background:#eee;" onerror="this.src=\'https://via.placeholder.com/190x180?text=Livre\'">' +
      '<div style="padding:10px; flex:1; display:flex; flex-direction:column;">' +
      '<strong style="display:block;color:#2b293a;font-size:14px;line-height:1.25;margin-bottom:4px;">' + esc(book.titre) + '</strong>' +
      '<span style="display:block;color:#777;font-size:12px;margin-bottom:4px;">' + esc(book.auteur) + '</span>' +
      '<span style="display:block;color:#ff690c;font-size:12px;font-weight:700;margin-bottom:auto;">' + esc(book.genre) + '</span>' +
      '<strong style="display:block;margin:8px 0;color:#111;">' + money(book.prix) + '</strong>' +
      '<button type="button" data-id="' + book.id + '" style="width:100%;border:0;background:#ff690c;color:#fff;padding:8px 10px;border-radius:999px;cursor:pointer;font-weight:700;transition:background 0.15s;">Ajouter au panier</button>' +
      '</div>';
    card.querySelector("button").addEventListener("click", function () {
      post("/api/cart/add", { id: book.id, qty: 1 }).then(function () {
        updateCartBadge();
        toast("Livre ajouté au panier.");
      }).catch(function (error) { toast(error.error || "Ajout impossible.", "error"); });
    });
    card.addEventListener("dblclick", function () {
      window.location.href = "/PI_Produit.html?id=" + book.id;
    });
    return card;
  }

  function ensureCatalogContainer() {
    var container = document.getElementById("con-A70") || document.getElementById("magma-catalog");
    if (!container) {
      container = document.createElement("section");
      container.id = "magma-catalog";
      container.style.cssText = "max-width:1100px;margin:40px auto;padding:20px;background:rgba(255,255,255,.95);border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.12);";
      container.innerHTML = '<h2 style="font-family:Arial,sans-serif;color:#2b293a;margin:0 0 12px;">Catalogue</h2><div id="magma-catalog-tools"></div><div id="magma-book-list"></div>';
      document.body.appendChild(container);
    }
    return container;
  }

  function initHome() {
    if (window.MAGMA_HOMEPAGE_CUSTOM) return;
    var container = ensureCatalogContainer();

    var tools = document.getElementById("magma-catalog-tools");
    if (!tools) {
      tools = document.createElement("div");
      tools.id = "magma-catalog-tools";
      tools.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;padding:10px 8px 4px;box-sizing:border-box;width:100%;";
      container.insertBefore(tools, container.firstChild);
    }

    var list = document.getElementById("magma-book-list");
    if (!list) {
      list = document.createElement("div");
      list.id = "magma-book-list";
      list.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;padding:8px;box-sizing:border-box;width:100%;";
      container.appendChild(list);
    }

    tools.innerHTML = '<input id="magma-search" placeholder="Rechercher un livre ou auteur" style="flex:1;min-width:220px;padding:11px;border:1px solid #ddd;border-radius:12px;box-sizing:border-box;"> <select id="magma-genre" style="padding:11px;border:1px solid #ddd;border-radius:12px;"><option value="">Toutes les catégories</option></select>';

    // Pré-remplit le champ de recherche si la page est ouverte avec ?q=... (depuis la barre du header)
    try {
      var initialQuery = new URLSearchParams(window.location.search).get("q");
      if (initialQuery) document.getElementById("magma-search").value = initialQuery;
    } catch (e) {}

    function load() {
      var q = document.getElementById("magma-search").value.trim();
      var genre = document.getElementById("magma-genre").value;
      var params = [];
      if (q) params.push("search=" + encodeURIComponent(q));
      if (genre) params.push("genre=" + encodeURIComponent(genre));
      get("/api/books" + (params.length ? "?" + params.join("&") : "")).then(function (books) {
        list.innerHTML = "";
        if (!books.length) {
          list.innerHTML = '<p style="font-family:Arial,sans-serif;color:#777;">Aucun livre trouvé.</p>';
          return;
        }
        books.forEach(function (book) { list.appendChild(bookCard(book)); });
      });
    }

    get("/api/genres").then(function (genres) {
      var select = document.getElementById("magma-genre");
      genres.forEach(function (genre) {
        var option = document.createElement("option");
        option.value = genre;
        option.textContent = genre;
        select.appendChild(option);
      });
    });
    document.getElementById("magma-search").addEventListener("input", load);
    document.getElementById("magma-genre").addEventListener("change", load);
    load();
  }

  function initCart() {
    var container = document.getElementById("A2_HTE") || document.getElementById("magma-cart");
    if (!container) {
      container = document.createElement("section");
      container.id = "magma-cart";
      container.style.cssText = "max-width:980px;margin:80px auto 30px;padding:20px;background:#fff;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.12);font-family:Arial,sans-serif;";
      document.body.appendChild(container);
    }

    function render() {
      get("/api/cart").then(function (cart) {
        var total = cart.reduce(function (sum, item) { return sum + item.prix * item.qty; }, 0);
        var totalQty = cart.reduce(function (s, i) { return s + Number(i.qty || 0); }, 0);
        container.classList.add("magma-cart");
        container.innerHTML = '<header class="magma-cart__head"><h2>Mon panier</h2><span class="magma-cart__count">' + totalQty + ' article' + (totalQty > 1 ? 's' : '') + '</span></header>';
        if (!cart.length) {
          container.innerHTML += '<div class="magma-cart__empty"><p>Votre panier est vide.</p><a href="/catalogue.html" class="magma-cart__shopbtn">Découvrir le catalogue</a></div>';
          return;
        }
        var list = document.createElement("div");
        list.className = "magma-cart__list";
        cart.forEach(function (item) {
          var subtotal = item.prix * item.qty;
          var row = document.createElement("article");
          row.className = "magma-cart__row";
          row.innerHTML =
            '<img class="magma-cart__img" src="' + esc(item.image || "") + '" alt="' + esc(item.titre) + '" onerror="this.style.visibility=\'hidden\'">' +
            '<div class="magma-cart__info">' +
              '<h3 class="magma-cart__title">' + esc(item.titre) + '</h3>' +
              '<p class="magma-cart__author">' + esc(item.auteur) + '</p>' +
              '<p class="magma-cart__qty">Quantité : <strong>' + item.qty + '</strong></p>' +
            '</div>' +
            '<div class="magma-cart__pricecol">' +
              '<span class="magma-cart__unit">' + money(item.prix) + ' / unité</span>' +
              '<strong class="magma-cart__sub">' + money(subtotal) + '</strong>' +
            '</div>' +
            '<button type="button" class="magma-cart__remove" data-id="' + item.id + '" aria-label="Supprimer ' + esc(item.titre) + '">✕</button>';
          row.querySelector("button").addEventListener("click", function () {
            del("/api/cart/remove/" + item.id).then(function () { updateCartBadge(); render(); });
          });
          list.appendChild(row);
        });
        container.appendChild(list);
        var totalBlock = document.createElement("div");
        totalBlock.className = "magma-cart__totalblock";
        totalBlock.innerHTML = '<span class="magma-cart__totallabel">Total à payer</span><span class="magma-cart__totalvalue">' + money(total) + '</span>';
        container.appendChild(totalBlock);
        var co = document.createElement("div");
        co.id = "magma-checkout";
        container.appendChild(co);
        renderCheckout();
      });
    }

    function renderCheckout() {
      var checkout = document.getElementById("magma-checkout");
      Promise.all([
        get("/api/delivery-zones"),
        get("/api/auth/status").catch(function () { return { user: null }; })
      ]).then(function (results) {
        var zones = results[0];
        var user = (results[1] && results[1].user) || {};
        var hasName = !!user.name;
        var hasEmail = !!user.email;
        var hasPhone = !!user.phone;
        var missing = [];
        if (!hasName) missing.push("nom");
        if (!hasEmail) missing.push("email");
        if (!hasPhone) missing.push("téléphone");
        var profileBlock = '<div class="magma-co__profile">' +
          '<h4>Vos informations</h4>' +
          '<dl>' +
            '<dt>Nom</dt><dd>' + (hasName ? esc(user.name) : '<em>Non renseigné</em>') + '</dd>' +
            '<dt>Email</dt><dd>' + (hasEmail ? esc(user.email) : '<em>Non renseigné</em>') + '</dd>' +
            '<dt>Téléphone</dt><dd>' + (hasPhone ? esc(user.phone) : '<em>Non renseigné</em>') + '</dd>' +
          '</dl>' +
          (missing.length ? '<p class="magma-co__warn">Veuillez compléter votre ' + missing.join(", ") + ' ci-dessous pour valider la commande.</p>' : '') +
        '</div>';
        var phoneFallback = hasPhone ? '' : '<input id="co-phone" placeholder="Téléphone" class="magma-co__field">';
        checkout.className = "magma-co";
        checkout.innerHTML = '<h3 class="magma-co__title">Passer commande</h3>' +
          '<p class="magma-co__notice">Livraison uniquement : Potopoto la gare, Total vers Saint Exupérie, Présidence, OSH, CHU. Hors zone, achat impossible.</p>' +
          profileBlock +
          '<label class="magma-co__label" for="co-zone">Zone de livraison</label>' +
          '<select id="co-zone" class="magma-co__field"><option value="">Choisir la zone de livraison</option>' + zones.map(function (z) { return '<option value="' + esc(z) + '">' + esc(z) + '</option>'; }).join("") + '</select>' +
          phoneFallback +
          '<button id="co-submit" type="button" class="magma-co__submit">Valider la commande</button>' +
          '<div id="co-result" class="magma-co__result"></div>';
        document.getElementById("co-submit").addEventListener("click", function () {
          var phoneVal = hasPhone ? user.phone : (document.getElementById("co-phone") || {}).value;
          post("/api/orders", {
            customer_name: user.name || "",
            customer_email: user.email || "",
            customer_phone: phoneVal || "",
            delivery_zone: document.getElementById("co-zone").value,
            delivery_address: user.name ? ("Compte: " + user.name) : "Livraison à domicile"
          }).then(function (res) {
            updateCartBadge();
            document.getElementById("co-result").innerHTML = '<div style="background:#ecfdf3;border:1px solid #abefc6;padding:12px;border-radius:12px;color:#067647;">Commande validée #' + res.order.id + '. <a href="' + res.receipt_url + '">Télécharger le reçu PDF</a><br><button type="button" id="cancel-order" style="margin-top:8px;background:#fef3c7;border:1px solid #fde68a;color:#92400e;border-radius:6px;padding:4px 8px;cursor:pointer;">Demander l\'annulation de la commande</button></div>';
            document.getElementById("cancel-order").addEventListener("click", function () {
              var reason = prompt("Pourquoi voulez-vous annuler cette commande ?","");
              if (reason === null) return;
              post("/api/orders/" + res.order.id + "/request-cancel", { reason: reason }).then(function () {
                toast("Demande d'annulation envoyée.");
                render();
              }).catch(function (error) { toast(error.error || "Demande impossible.", "error"); });
            });
          }).catch(function (error) { toast(error.error || "Commande impossible.", "error"); });
        });
      });
    }

    render();

    var myOrdersSection = document.createElement("section");
    myOrdersSection.id = "magma-my-orders";
    myOrdersSection.style.cssText = "max-width:980px;margin:28px auto 40px;padding:24px;background:#fff;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.10);font-family:Arial,sans-serif;";
    document.body.appendChild(myOrdersSection);

    function renderMyOrders() {
      myOrdersSection.innerHTML = '<h2 style="margin-bottom:18px;">Mes commandes</h2>';
      get("/api/my-orders").then(function (orders) {
        if (!orders || orders.length === 0) {
          myOrdersSection.innerHTML += '<p style="color:#888;font-size:14px;">Vous n\'avez pas encore passé de commande.</p>';
          return;
        }
        var statusColor = { "En attente":"#854d0e", "Confirmée":"#166534", "En livraison":"#1e40af", "Livrée":"#5b21b6", "Annulée":"#b42318", "Validée":"#065f46" };
        var statusBg = { "En attente":"#fef9c3", "Confirmée":"#dcfce7", "En livraison":"#dbeafe", "Livrée":"#ede9fe", "Annulée":"#fee4e2", "Validée":"#d1fae5" };
        orders.forEach(function (o) {
          var card = document.createElement("div");
          card.style.cssText = "border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;background:#fafafa;";
          var bg = statusBg[o.status] || "#f3f4f6";
          var col = statusColor[o.status] || "#555";
          var itemsList = (o.items || []).map(function (i) {
            return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0;">'
              + (i.image ? '<img src="' + esc(i.image) + '" style="width:38px;height:50px;object-fit:cover;border-radius:5px;background:#eee;" onerror="this.style.display=\'none\'">' : '')
              + '<div style="flex:1;"><span style="font-weight:600;">' + esc(i.titre) + '</span><br><span style="color:#888;font-size:12px;">' + esc(i.auteur) + ' · ' + esc(i.qty) + ' ex. · ' + money(i.prix) + '</span></div></div>';
          }).join("");
          var canConfirm = !o.client_confirmed && ["En livraison", "Livrée"].includes(o.status);
          var canCancel = ["En attente", "Confirmée", "En livraison"].includes(o.status) && !o.cancel_requested;
          card.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:10px;">'
            + '<div><strong style="font-size:15px;">Commande #' + esc(o.id) + '</strong><div style="font-size:12px;color:#888;margin-top:3px;">' + fmtDate(o.created_at) + ' · ' + money(o.total) + '</div></div>'
            + '<span style="background:' + bg + ';color:' + col + ';padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap;">' + esc(o.status) + '</span>'
            + '</div>'
            + (itemsList ? '<div style="margin:0 0 12px;">' + itemsList + '</div>' : '')
            + '<div style="font-size:13px;color:#666;margin-bottom:10px;">📍 ' + esc(o.delivery_zone) + (o.delivery_address ? ' — ' + esc(o.delivery_address) : '') + '</div>'
            + (o.client_confirmed ? '<div style="font-size:12px;padding:6px 12px;background:#dcfce7;color:#166534;border-radius:999px;display:inline-block;margin-bottom:8px;">✓ Vous avez confirmé la réception</div>' : '')
            + (o.cancel_requested ? '<div style="font-size:12px;padding:6px 12px;background:#fee4e2;color:#b42318;border-radius:999px;display:inline-block;margin-bottom:8px;font-weight:600;">⚠ Demande d\'annulation en cours</div>' : '')
            + (canConfirm ? '<div><button class="confirm-btn" data-oid="' + o.id + '" style="background:#ff690c;color:#fff;border:0;border-radius:999px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-right:8px;">Confirmer la réception</button></div>' : '')
            + (canCancel ? '<div style="margin-top:4px;"><button class="cancel-req-btn" data-oid="' + o.id + '" style="background:#fff;color:#b42318;border:1.5px solid #b42318;border-radius:999px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;">Demander l\'annulation</button></div>' : '')
            + (o.status === "Annulée" && o.cancelled_at ? '<div style="font-size:12px;color:#b42318;">Annulée le ' + fmtDate(o.cancelled_at) + '</div>' : '')
            + (o.status === "Validée" && o.validated_at ? '<div style="font-size:12px;color:#065f46;margin-top:4px;">✅ Commande validée le ' + fmtDate(o.validated_at) + '</div>' : '');

          myOrdersSection.appendChild(card);
        });

        myOrdersSection.querySelectorAll(".confirm-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var oid = btn.getAttribute("data-oid");
            btn.disabled = true;
            btn.textContent = "Envoi…";
            post("/api/orders/" + oid + "/confirm-reception", {})
              .then(function (updated) {
                toast(updated.status === "Validée" ? "Réception confirmée — Commande validée !" : "Réception confirmée.");
                renderMyOrders();
              })
              .catch(function (e) { toast((e && e.error) || "Erreur lors de la confirmation.", "error"); btn.disabled = false; btn.textContent = "Confirmer la réception"; });
          });
        });

        myOrdersSection.querySelectorAll(".cancel-req-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var oid = btn.getAttribute("data-oid");
            var reason = prompt("Pourquoi voulez-vous annuler cette commande ?","");
            if (reason === null) return;
            btn.disabled = true;
            btn.textContent = "Envoi…";
            post("/api/orders/" + oid + "/request-cancel", { reason: reason })
              .then(function () {
                toast("Demande d'annulation envoyée.");
                renderMyOrders();
              })
              .catch(function (e) { toast((e && e.error) || "Erreur.", "error"); btn.disabled = false; btn.textContent = "Demander l'annulation"; });
          });
        });
      }).catch(function () {
        myOrdersSection.innerHTML += '<p style="color:#888;font-size:14px;">Connectez-vous pour voir vos commandes.</p>';
      });
    }

    renderMyOrders();
  }

  function fmtDate(s) {
    if (!s) return "—";
    var d = new Date(s.indexOf("T") !== -1 ? s : s + "Z");
    if (isNaN(d)) return s;
    return d.toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
  }

  function initDetail() {
    if (window.MAGMA_DETAIL_CUSTOM) return;
    var params = new URLSearchParams(window.location.search);
    var id = params.get("id");
    if (!id) return;
    var section = document.createElement("section");
    section.id = "magma-detail-extra";
    section.style.cssText = "max-width:920px;margin:30px auto;padding:18px;background:#fff;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.12);font-family:Arial,sans-serif;";
    document.body.appendChild(section);
    get("/api/books/" + id).then(function (book) {
      var stock = parseInt(book.stock) || 0;
      var stockBadge = stock <= 0 ? '<span style="display:inline-block;margin-bottom:10px;background:#e53e3e;color:white;font-size:12px;font-weight:bold;padding:4px 8px;border-radius:4px;">Épuisé</span><br>' : (stock <= 3 ? '<span style="display:inline-block;margin-bottom:10px;background:#dd6b20;color:white;font-size:12px;font-weight:bold;padding:4px 8px;border-radius:4px;">Plus que ' + stock + ' !</span><br>' : '');
      var btnHTML = stock <= 0 ? '<button id="detail-add" type="button" disabled style="background:#ccc;color:#666;border:0;border-radius:999px;padding:10px 16px;font-weight:700;cursor:not-allowed;">Indisponible</button>' : '<button id="detail-add" type="button" style="background:#ff690c;color:#fff;border:0;border-radius:999px;padding:10px 16px;font-weight:700;cursor:pointer;">Ajouter au panier</button>';
      
      section.innerHTML = '<h2>' + esc(book.titre) + '</h2>' + stockBadge + '<p><strong>' + esc(book.auteur) + '</strong> — ' + esc(book.genre) + '</p><p>' + esc(book.description || "") + '</p><p>' + esc(book.infos || "") + '</p><h3>' + money(book.prix) + '</h3>' + btnHTML + '<hr><h3>Avis récents</h3><div id="review-list"></div><div><input id="review-name" placeholder="Votre nom" style="padding:9px;margin:4px;width:180px;"><select id="review-rating" style="padding:9px;margin:4px;"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select><input id="review-comment" placeholder="Votre commentaire" style="padding:9px;margin:4px;width:260px;"><button id="review-submit" type="button">Publier</button></div>';
      
      var addBtn = document.getElementById("detail-add");
      if (stock > 0 && addBtn) {
        addBtn.addEventListener("click", function () {
          post("/api/cart/add", { id: Number(id), qty: 1 }).then(function () { updateCartBadge(); toast("Livre ajouté au panier."); }).catch(function (error) { toast(error.error || "Ajout impossible.", "error"); });
        });
      }
      function loadReviews() {
        get("/api/books/" + id + "/reviews").then(function (reviews) {
          document.getElementById("review-list").innerHTML = reviews.length ? reviews.map(renderReview).join("") : '<p>Aucun avis pour ce livre.</p>';
        });
      }
      document.getElementById("review-submit").addEventListener("click", function () {
        post("/api/reviews", { book_id: Number(id), customer_name: document.getElementById("review-name").value, rating: document.getElementById("review-rating").value, comment: document.getElementById("review-comment").value }).then(function (response) {
          var list = document.getElementById("review-list");
          if (response.review) {
            if (list.textContent.indexOf("Aucun avis") !== -1) list.innerHTML = "";
            list.insertAdjacentHTML("afterbegin", renderReview(response.review));
          } else {
            loadReviews();
          }
          document.getElementById("review-comment").value = "";
          toast(response.message || "Avis enregistré");
        }).catch(function (error) { toast(error.error || "Avis impossible.", "error"); });
      });
      loadReviews();
    });
  }

  function initAdmin() {
    var host = document.getElementById("magma-admin-root");
    if (!host) {
      host = document.createElement("section");
      host.id = "magma-admin-root";
      host.style.cssText = "max-width:1100px;margin:90px auto 40px;padding:22px;background:#fff;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.12);font-family:Arial,sans-serif;";
      document.body.appendChild(host);
    }

    function loginForm(message) {
      host.innerHTML = '<h1>Admin</h1><p>Accès protégé pour gérer les livres et les publicités.</p>' + (message ? '<p style="color:#b42318;">' + esc(message) + '</p>' : '') + '<input id="admin-password" type="password" placeholder="Mot de passe admin" style="padding:12px;border:1px solid #ddd;border-radius:12px;min-width:260px;"> <button id="admin-login" type="button" style="background:#2b293a;color:#fff;border:0;border-radius:999px;padding:12px 18px;cursor:pointer;">Entrer</button>';
      document.getElementById("admin-login").addEventListener("click", function () {
        post("/api/admin/login", { password: document.getElementById("admin-password").value }).then(renderPanel).catch(function (error) { loginForm(error.error || "Accès refusé."); });
      });
    }

    function field(id, placeholder, type) {
      return '<input id="' + id + '" type="' + (type || "text") + '" placeholder="' + placeholder + '" style="width:100%;padding:10px;margin:5px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;">';
    }

    function renderPanel() {
      host.innerHTML = '<h1>Admin</h1><button id="admin-logout" type="button">Déconnexion</button><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-top:18px;"><section><h2>Livre</h2><input type="hidden" id="book-id">' + field("book-title", "Titre") + field("book-author", "Auteur") + field("book-category", "Catégorie") + field("book-price", "Prix", "number") + field("book-image", "URL de l'image") + field("book-stock", "Stock", "number") + '<textarea id="book-description" placeholder="Description" style="width:100%;padding:10px;margin:5px 0;min-height:70px;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;"></textarea><textarea id="book-infos" placeholder="Infos supplémentaires" style="width:100%;padding:10px;margin:5px 0;min-height:60px;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;"></textarea><label><input id="book-featured" type="checkbox"> En vedette</label><br><button id="book-save" type="button" style="margin-top:8px;background:#ff690c;color:#fff;border:0;border-radius:999px;padding:10px 16px;cursor:pointer;">Enregistrer</button><button id="book-reset" type="button">Nouveau</button></section><section><h2>Publicité</h2>' + field("ad-title", "Titre") + field("ad-message", "Message") + field("ad-link", "Lien optionnel") + '<button id="ad-save" type="button">Publier</button><div id="ad-list"></div></section></div><h2>Livres existants</h2><div id="admin-books"></div>';
      document.getElementById("admin-logout").addEventListener("click", function () { post("/api/admin/logout", {}).then(loginForm); });
      document.getElementById("book-reset").addEventListener("click", clearBookForm);
      document.getElementById("book-save").addEventListener("click", saveBook);
      document.getElementById("ad-save").addEventListener("click", saveAd);
      loadAdminBooks();
      loadAds();
    }

    function clearBookForm() {
      ["book-id", "book-title", "book-author", "book-category", "book-price", "book-image", "book-stock", "book-description", "book-infos"].forEach(function (id) { document.getElementById(id).value = ""; });
      document.getElementById("book-featured").checked = false;
    }

    function bookPayload() {
      return {
        titre: document.getElementById("book-title").value,
        auteur: document.getElementById("book-author").value,
        genre: document.getElementById("book-category").value,
        prix: document.getElementById("book-price").value,
        image: document.getElementById("book-image").value,
        stock: document.getElementById("book-stock").value || 10,
        description: document.getElementById("book-description").value,
        infos: document.getElementById("book-infos").value,
        featured: document.getElementById("book-featured").checked
      };
    }

    function saveBook() {
      var id = document.getElementById("book-id").value;
      var action = id ? put("/api/books/" + id, bookPayload()) : post("/api/books", bookPayload());
      action.then(function () { toast("Livre enregistré."); clearBookForm(); loadAdminBooks(); }).catch(function (error) { toast(error.error || "Erreur livre.", "error"); });
    }

    function loadAdminBooks() {
      get("/api/books").then(function (books) {
        var wrap = document.getElementById("admin-books");
        wrap.innerHTML = books.map(function (b) {
          return '<div style="display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;padding:10px 0;"><img src="' + esc(b.image || "") + '" style="width:46px;height:60px;object-fit:cover;background:#eee;"><div style="flex:1;"><strong>' + esc(b.titre) + '</strong><br><small>' + esc(b.auteur) + ' — ' + esc(b.genre) + ' — ' + money(b.prix) + '</small></div><button data-edit="' + b.id + '">Modifier</button><button data-del="' + b.id + '">Supprimer</button></div>';
        }).join("");
        wrap.querySelectorAll("[data-edit]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var b = books.find(function (x) { return x.id == btn.getAttribute("data-edit"); });
            document.getElementById("book-id").value = b.id;
            document.getElementById("book-title").value = b.titre;
            document.getElementById("book-author").value = b.auteur;
            document.getElementById("book-category").value = b.genre;
            document.getElementById("book-price").value = b.prix;
            document.getElementById("book-image").value = b.image || "";
            document.getElementById("book-stock").value = b.stock;
            document.getElementById("book-description").value = b.description || "";
            document.getElementById("book-infos").value = b.infos || "";
            document.getElementById("book-featured").checked = !!b.featured;
            window.scrollTo({ top: 0, behavior: "smooth" });
          });
        });
        wrap.querySelectorAll("[data-del]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            if (!confirm("Supprimer ce livre ?")) return;
            del("/api/books/" + btn.getAttribute("data-del")).then(function () { toast("Livre supprimé."); loadAdminBooks(); }).catch(function (error) { toast(error.error || "Suppression impossible.", "error"); });
          });
        });
      });
    }

    function saveAd() {
      post("/api/admin/ads", { title: document.getElementById("ad-title").value, message: document.getElementById("ad-message").value, link: document.getElementById("ad-link").value, active: true }).then(function () { toast("Publicité publiée."); document.getElementById("ad-title").value = ""; document.getElementById("ad-message").value = ""; document.getElementById("ad-link").value = ""; loadAds(); }).catch(function (error) { toast(error.error || "Publicité impossible.", "error"); });
    }

    function loadAds() {
      get("/api/admin/ads").then(function (ads) {
        var list = document.getElementById("ad-list");
        list.innerHTML = ads.map(function (ad) { return '<p><strong>' + esc(ad.title) + '</strong><br>' + esc(ad.message) + '<br><button data-ad-del="' + ad.id + '">Supprimer</button></p>'; }).join("");
        list.querySelectorAll("[data-ad-del]").forEach(function (btn) {
          btn.addEventListener("click", function () { del("/api/admin/ads/" + btn.getAttribute("data-ad-del")).then(loadAds); });
        });
      });
    }

    get("/api/admin/status").then(function (status) { status.authenticated ? renderPanel() : loginForm(); }).catch(loginForm);
  }

  function initLogin() {
    var params = new URLSearchParams(window.location.search);
    var errorMsg = params.get("error");
    var errHtml = errorMsg
      ? '<p style="background:#fee4e2;color:#b42318;padding:10px 14px;border-radius:4px;margin:0 0 14px;font-size:13px;">' + esc(decodeURIComponent(errorMsg)) + '</p>'
      : '';

    var fieldStyle = 'width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:3px;font-size:14px;background:#f0f0f0;color:#333;box-sizing:border-box;font-family:Arial,sans-serif;outline:none;';
    var labelStyle = 'display:block;font-size:13px;color:#555;margin-bottom:6px;';

    var shell = document.createElement("div");
    shell.id = "magma-login-shell";
    shell.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#e8e8e8;font-family:Arial,sans-serif;";
    shell.innerHTML =
      '<div class="magma-auth-card" style="display:flex;width:min(900px,96vw);min-height:480px;border-radius:6px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.18);">' +
        '<div class="magma-auth-left" style="flex:1;position:relative;background:url(\'/img/WhatsApp%20Image%202025-11-19%20at%2012.10.23.jpeg\') center center/cover no-repeat;display:flex;flex-direction:column;justify-content:flex-start;padding:28px 32px 32px;min-width:260px;">' +
          '<div style="position:absolute;inset:0;background:rgba(30,40,30,.35);z-index:0;"></div>' +
          '<div style="position:relative;z-index:1;">' +
            '<div style="width:54px;height:54px;margin-bottom:28px;"><img src="/img/Logo version mobile.png" alt="Logo" style="width:100%;height:100%;object-fit:contain;border-radius:50%;"></div>' +
            '<h2 style="font-size:28px;font-weight:900;color:#fff;line-height:1.25;letter-spacing:.3px;margin:0;">Connecter vous sur<br>Mayombe</h2>' +
          '</div>' +
        '</div>' +
        '<div class="magma-auth-right" style="width:380px;flex-shrink:0;background:#f9f9f9;display:flex;flex-direction:column;justify-content:center;padding:48px 40px;">' +
          '<h1 style="font-size:32px;font-weight:400;color:#888;margin:0 0 8px;">Login</h1>' +
          '<p style="font-size:14px;color:#888;margin:0 0 28px;line-height:1.5;">Bienvenu entrer votre identifiant<br>s\'il vous plait</p>' +
          errHtml +
          '<div style="margin-bottom:18px;"><label style="' + labelStyle + '">Nom d\'utilisateur ou Email</label><input id="login-email" type="text" autocomplete="username" style="' + fieldStyle + '"></div>' +
          '<div style="margin-bottom:18px;"><label style="' + labelStyle + '">Mot de passe</label><input id="login-password" type="password" autocomplete="current-password" style="' + fieldStyle + '"></div>' +
          '<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#555;margin-bottom:24px;"><input type="checkbox" id="remember-me" style="width:15px;height:15px;accent-color:#ff690c;cursor:pointer;"><label for="remember-me">Se souvenir de moi</label></div>' +
          '<button id="login-submit" type="button" style="width:100%;padding:13px;background:#ff690c;color:#fff;font-size:15px;font-weight:600;border:none;border-radius:3px;cursor:pointer;">Login</button>' +
          '<p style="margin-top:14px;font-size:13px;color:#888;text-align:center;"><a id="forgot-password" href="#" style="color:#ff690c;text-decoration:none;font-weight:600;">Mot de passe oublié</a></p>' +
          '<p style="margin-top:18px;font-size:13px;color:#888;text-align:center;">Pas encore de compte ? <a id="goto-register" href="#" style="color:#ff690c;text-decoration:none;font-weight:600;">Créer un compte</a></p>' +
        '</div>' +
      '</div>';

    document.body.appendChild(shell);

    document.getElementById("goto-register").addEventListener("click", function (e) {
      e.preventDefault();
      window.location.href = "/register.html";
    });

    document.getElementById("forgot-password").addEventListener("click", function (e) {
      e.preventDefault();
      openForgotPasswordModal(fieldStyle, labelStyle);
    });

    // Pré-remplit l'email mémorisé si l'utilisateur avait déjà coché "Se souvenir de moi"
    try {
      var rememberedEmail = localStorage.getItem("magma_remember_email");
      if (rememberedEmail) {
        document.getElementById("login-email").value = rememberedEmail;
        document.getElementById("remember-me").checked = true;
      }
    } catch (e) {}

    document.getElementById("login-submit").addEventListener("click", function () {
      var email = document.getElementById("login-email").value.trim();
      var pass = document.getElementById("login-password").value;
      var remember = !!document.getElementById("remember-me").checked;
      if (!email || !pass) { toast("Veuillez saisir votre email et mot de passe.", "error"); return; }
      
      var btn = document.getElementById("login-submit");
      btn.disabled = true;
      var originalHtml = btn.innerHTML;
      
      // Inject spin style dynamically if missing
      if (!document.getElementById("magma-spin-style")) {
        var styleEl = document.createElement("style");
        styleEl.id = "magma-spin-style";
        styleEl.textContent = "@keyframes magma-spin { to { transform: rotate(360deg); } }";
        document.head.appendChild(styleEl);
      }
      
      btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-radius:50%;border-top-color:#fff;animation:magma-spin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span> Connexion...';
      btn.style.background = "#ffa870";
      btn.style.cursor = "not-allowed";
      
      post("/api/auth/login", { email: email, password: pass, remember: remember })
        .then(function () {
          try {
            if (remember) localStorage.setItem("magma_remember_email", email);
            else localStorage.removeItem("magma_remember_email");
          } catch (e) {}
          window.location.href = "/";
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
          btn.style.background = "#ff690c";
          btn.style.cursor = "pointer";
          toast((err && err.error) || "Email ou mot de passe incorrect.", "error");
        });
    });

    ["login-email", "login-password"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") document.getElementById("login-submit").click();
      });
    });

    if (errorMsg) toast(decodeURIComponent(errorMsg), "error");
  }

  function initRegister() {
    var params = new URLSearchParams(window.location.search);
    var errorMsg = params.get("error");
    var errHtml = errorMsg
      ? '<p style="background:#fee4e2;color:#b42318;padding:10px 14px;border-radius:4px;margin:0 0 14px;font-size:13px;">' + esc(decodeURIComponent(errorMsg)) + '</p>'
      : '';

    var fieldStyle = 'width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:3px;font-size:14px;background:#f4f4f4;color:#333;box-sizing:border-box;font-family:Arial,sans-serif;outline:none;';
    var labelStyle = 'display:block;font-size:13px;color:#555;margin-bottom:6px;';

    var shell = document.createElement("div");
    shell.id = "magma-register-shell";
    shell.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#e8e8e8;font-family:Arial,sans-serif;";
    shell.innerHTML =
      '<div class="magma-auth-card" style="display:flex;width:min(900px,96vw);min-height:520px;border-radius:6px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.22);">' +
        '<div class="magma-auth-left" style="flex:1;position:relative;background:#2b293a;display:flex;flex-direction:column;justify-content:space-between;padding:36px 32px 40px;min-width:260px;">' +
          '<div>' +
            '<div style="width:54px;height:54px;margin-bottom:32px;"><img src="/img/Logo version mobile.png" alt="Logo" style="width:100%;height:100%;object-fit:contain;filter:brightness(0) invert(1);border-radius:50%;"></div>' +
            '<h2 style="font-size:26px;font-weight:900;color:#fff;line-height:1.3;margin:0 0 12px;">Rejoignez<br>Librairie Mayombe</h2>' +
            '<p style="color:rgba(255,255,255,.65);font-size:14px;line-height:1.6;margin:0;">Accédez à notre catalogue,<br>gérez votre panier et<br>suivez vos commandes.</p>' +
          '</div>' +
          '<div style="border-top:1px solid rgba(255,255,255,.15);padding-top:20px;">' +
            '<p style="color:rgba(255,255,255,.5);font-size:12px;margin:0;">Déjà un compte ? <a href="/login.html" style="color:#ff690c;text-decoration:none;font-weight:700;">Se connecter</a></p>' +
          '</div>' +
        '</div>' +
        '<div class="magma-auth-right" style="width:400px;flex-shrink:0;background:#fff;display:flex;flex-direction:column;justify-content:center;padding:48px 40px;">' +
          '<h1 style="font-size:26px;font-weight:700;color:#2b293a;margin:0 0 4px;">Créer un compte</h1>' +
          '<p style="font-size:14px;color:#999;margin:0 0 28px;line-height:1.5;">Remplissez le formulaire pour commencer</p>' +
          errHtml +
          '<div style="margin-bottom:16px;"><label style="' + labelStyle + '">Nom complet</label><input id="reg-name" type="text" autocomplete="name" style="' + fieldStyle + '"></div>' +
          '<div style="margin-bottom:16px;"><label style="' + labelStyle + '">Adresse email</label><input id="reg-email" type="email" autocomplete="email" style="' + fieldStyle + '"></div>' +
          '<div style="margin-bottom:16px;"><label style="' + labelStyle + '">Numéro de téléphone <span style="color:#aaa;font-size:11px;">(format XX-XXX-XXXX)</span></label><input id="reg-phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="XX-XXX-XXXX" maxlength="12" style="' + fieldStyle + '"></div>' +
          '<div style="margin-bottom:24px;"><label style="' + labelStyle + '">Mot de passe <span style="color:#aaa;font-size:11px;">(min. 8 caractères, lettre + chiffre)</span></label><input id="reg-password" type="password" autocomplete="new-password" style="' + fieldStyle + '"></div>' +
          '<button id="reg-submit" type="button" style="width:100%;padding:13px;background:#ff690c;color:#fff;font-size:15px;font-weight:700;border:none;border-radius:3px;cursor:pointer;letter-spacing:.3px;">Créer mon compte</button>' +
          '<p style="margin-top:16px;font-size:12px;color:#aaa;text-align:center;">En créant un compte, vous acceptez nos conditions d\'utilisation.</p>' +
        '</div>' +
      '</div>';

    document.body.appendChild(shell);

    // ===== Auto-formatage du numéro de téléphone : 06-548-7909 (XX-XXX-XXXX) =====
    function formatPhoneInput(rawDigits) {
      var d = String(rawDigits || "").replace(/\D+/g, "").slice(0, 9);
      if (d.length <= 2) return d;
      if (d.length <= 5) return d.slice(0, 2) + "-" + d.slice(2);
      return d.slice(0, 2) + "-" + d.slice(2, 5) + "-" + d.slice(5, 9);
    }
    var regPhoneInput = document.getElementById("reg-phone");
    if (regPhoneInput) {
      regPhoneInput.addEventListener("input", function () {
        var caretAtEnd = this.selectionStart === this.value.length;
        var formatted = formatPhoneInput(this.value);
        this.value = formatted;
        if (caretAtEnd) {
          // Place le curseur à la fin pour que la frappe continue naturellement
          try { this.setSelectionRange(formatted.length, formatted.length); } catch (e) {}
        }
      });
      regPhoneInput.addEventListener("blur", function () {
        this.value = formatPhoneInput(this.value);
      });
    }

    document.getElementById("reg-submit").addEventListener("click", function () {
      var name = document.getElementById("reg-name").value.trim();
      var email = document.getElementById("reg-email").value.trim();
      var phone = formatPhoneInput(document.getElementById("reg-phone").value);
      document.getElementById("reg-phone").value = phone;
      var pass = document.getElementById("reg-password").value;
      if (!name || !email || !phone || !pass) { toast("Veuillez remplir tous les champs.", "error"); return; }
      if (phone.replace(/\D+/g, "").length !== 9) { toast("Le numéro doit comporter 9 chiffres (ex: XX-XXX-XXXX).", "error"); return; }
      
      var btn = document.getElementById("reg-submit");
      btn.disabled = true;
      var originalHtml = btn.innerHTML;
      
      if (!document.getElementById("magma-spin-style")) {
        var styleEl = document.createElement("style");
        styleEl.id = "magma-spin-style";
        styleEl.textContent = "@keyframes magma-spin { to { transform: rotate(360deg); } }";
        document.head.appendChild(styleEl);
      }
      
      btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-radius:50%;border-top-color:#fff;animation:magma-spin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span> Inscription...';
      btn.style.background = "#ffa870";
      btn.style.cursor = "not-allowed";

      fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, email: email, phone: phone, password: pass }) })
        .then(function (r) {
          return r.json().then(function (d) {
            if (r.status === 409) {
              window.location.href = "/login.html?info=" + encodeURIComponent("Un compte existe déjà. Connectez-vous.");
            } else if (!r.ok) {
              throw d;
            } else {
              window.location.href = "/";
            }
          });
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
          btn.style.background = "#ff690c";
          btn.style.cursor = "pointer";
          toast((err && err.error) || "Inscription impossible.", "error");
        });
    });

    ["reg-name", "reg-email", "reg-phone", "reg-password"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") document.getElementById("reg-submit").click();
      });
    });

    if (errorMsg) toast(decodeURIComponent(errorMsg), "error");
  }

  function openForgotPasswordModal(fieldStyle, labelStyle) {
    var old = document.getElementById("forgot-password-modal");
    if (old) old.remove();
    var overlay = document.createElement("div");
    overlay.id = "forgot-password-modal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;font-family:Arial,sans-serif;";
    overlay.innerHTML =
      '<div style="width:min(420px,100%);background:#fff;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.22);padding:28px;box-sizing:border-box;">' +
        '<h2 style="font-size:24px;font-weight:400;color:#888;margin:0 0 8px;">Mot de passe oublié</h2>' +
        '<p style="font-size:13px;color:#888;margin:0 0 18px;line-height:1.5;">Entrez les trois informations de votre compte.</p>' +
        '<div id="forgot-error" style="display:none;background:#fee4e2;color:#b42318;padding:10px 14px;border-radius:4px;margin:0 0 14px;font-size:13px;"></div>' +
        '<div id="forgot-success" style="display:none;background:#ecfdf3;color:#1f7a4d;padding:10px 14px;border-radius:4px;margin:0 0 14px;font-size:13px;word-break:break-word;"></div>' +
        '<div style="margin-bottom:14px;"><label style="' + labelStyle + '">Nom</label><input id="forgot-name" type="text" autocomplete="name" style="' + fieldStyle + '"></div>' +
        '<div style="margin-bottom:14px;"><label style="' + labelStyle + '">Numéro de téléphone <span style="color:#aaa;font-size:11px;">(format XX-XXX-XXXX)</span></label><input id="forgot-phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="XX-XXX-XXXX" maxlength="12" style="' + fieldStyle + '"></div>' +
        '<div style="margin-bottom:18px;"><label style="' + labelStyle + '">Email</label><input id="forgot-email" type="email" autocomplete="email" style="' + fieldStyle + '"></div>' +
        '<button id="forgot-submit" type="button" style="width:100%;padding:13px;background:#ff690c;color:#fff;font-size:15px;font-weight:600;border:none;border-radius:3px;cursor:pointer;">Vérifier</button>' +
        '<button id="forgot-close" type="button" style="width:100%;padding:11px;background:#2b293a;color:#fff;font-size:14px;font-weight:600;border:none;border-radius:3px;cursor:pointer;margin-top:10px;">Fermer</button>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById("forgot-close").addEventListener("click", function () { overlay.remove(); });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });

    // Auto-formatage identique à la création de compte : 06-548-7909 (XX-XXX-XXXX)
    function formatForgotPhone(raw) {
      var d = String(raw || "").replace(/\D+/g, "").slice(0, 9);
      if (d.length <= 2) return d;
      if (d.length <= 5) return d.slice(0, 2) + "-" + d.slice(2);
      return d.slice(0, 2) + "-" + d.slice(2, 5) + "-" + d.slice(5, 9);
    }
    var forgotPhoneInput = document.getElementById("forgot-phone");
    if (forgotPhoneInput) {
      forgotPhoneInput.addEventListener("input", function () {
        var caretAtEnd = this.selectionStart === this.value.length;
        var formatted = formatForgotPhone(this.value);
        this.value = formatted;
        if (caretAtEnd) {
          try { this.setSelectionRange(formatted.length, formatted.length); } catch (e) {}
        }
      });
      forgotPhoneInput.addEventListener("blur", function () { this.value = formatForgotPhone(this.value); });
    }

    document.getElementById("forgot-submit").addEventListener("click", function () {
      var errorBox = document.getElementById("forgot-error");
      var successBox = document.getElementById("forgot-success");
      errorBox.style.display = "none";
      successBox.style.display = "none";
      var name = document.getElementById("forgot-name").value.trim();
      var phoneRaw = document.getElementById("forgot-phone").value.trim();
      var phone = formatForgotPhone(phoneRaw);
      document.getElementById("forgot-phone").value = phone;
      var email = document.getElementById("forgot-email").value.trim();
      if (!name || !phone || !email) {
        errorBox.textContent = "Nom, numéro de téléphone et email sont obligatoires.";
        errorBox.style.display = "block";
        return;
      }
      if (phone.replace(/\D+/g, "").length !== 9) {
        errorBox.textContent = "Le numéro doit comporter 9 chiffres (ex: XX-XXX-XXXX).";
        errorBox.style.display = "block";
        return;
      }
      post("/api/auth/forgot-password", { name: name, phone: phone, email: email }).then(function (data) {
        successBox.innerHTML = esc(data.message || "Lien généré.") + '<br><a href="' + esc(data.resetLink) + '" style="color:#1f7a4d;font-weight:700;">' + esc(data.resetLink) + '</a>';
        successBox.style.display = "block";
      }).catch(function (err) {
        errorBox.textContent = (err && err.error) || "Informations incorrectes.";
        errorBox.style.display = "block";
      });
    });
  }

  function initLegacyAdd() {
    var btn = document.getElementById("A8");
    if (!btn) return;
    btn.addEventListener("click", function () {
      toast("L'ajout de livres se fait maintenant depuis l'onglet Admin protégé.", "error");
      window.location.href = "/Admin.html";
    });
  }

  function applyTheme() {
    try {
      var t = localStorage.getItem("magma-theme") || "light";
      document.documentElement.setAttribute("data-magma-theme", t);
    } catch (e) {}
  }

  function openSettingsModal() { window.location.href = "/parametres.html"; return; /* legacy modal kept for fallback */
    var existing = document.getElementById("magma-settings-modal");
    if (existing) { existing.remove(); return; }
    var theme = "light";
    var notif = "1";
    try { theme = localStorage.getItem("magma-theme") || "light"; notif = localStorage.getItem("magma-notif") || "1"; } catch (e) {}
    var modal = document.createElement("div");
    modal.id = "magma-settings-modal";
    modal.innerHTML =
      '<div class="ms-overlay"></div>' +
      '<div class="ms-box" role="dialog" aria-modal="true" aria-labelledby="ms-title">' +
        '<header><h3 id="ms-title">Paramètres</h3><button type="button" class="ms-close" aria-label="Fermer">✕</button></header>' +
        '<div class="ms-body">' +
          '<div class="ms-field"><label>Thème d\'affichage</label>' +
            '<div class="ms-segmented">' +
              '<button type="button" data-theme="light" class="' + (theme==="light"?"on":"") + '">☀ Clair</button>' +
              '<button type="button" data-theme="dark" class="' + (theme==="dark"?"on":"") + '">🌙 Sombre</button>' +
            '</div>' +
          '</div>' +
          '<div class="ms-field ms-toggle-row"><label for="ms-notif">Notifications</label>' +
            '<label class="ms-switch"><input type="checkbox" id="ms-notif" ' + (notif==="1"?"checked":"") + '><span></span></label>' +
          '</div>' +
          '<div class="ms-field"><label>Compte</label>' +
            '<a class="ms-link" href="/mon-compte.html">Mon Compte</a>' +
            '<a class="ms-link" href="/mes-commandes.html">Mes Commandes</a>' +
          '</div>' +
        '</div>' +
        '<footer><button type="button" class="ms-save">Enregistrer</button></footer>' +
      '</div>';
    document.body.appendChild(modal);
    function close() { modal.remove(); }
    modal.querySelector(".ms-overlay").addEventListener("click", close);
    modal.querySelector(".ms-close").addEventListener("click", close);
    modal.querySelectorAll(".ms-segmented button").forEach(function (b) {
      b.addEventListener("click", function () {
        modal.querySelectorAll(".ms-segmented button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
      });
    });
    modal.querySelector(".ms-save").addEventListener("click", function () {
      var t = (modal.querySelector(".ms-segmented button.on") || {}).getAttribute && modal.querySelector(".ms-segmented button.on").getAttribute("data-theme") || "light";
      var n = modal.querySelector("#ms-notif").checked ? "1" : "0";
      try { localStorage.setItem("magma-theme", t); localStorage.setItem("magma-notif", n); } catch (e) {}
      applyTheme();
      toast("Paramètres enregistrés.");
      close();
    });
  }

  function wireHomeIcons() {
    var account = document.getElementById("A87");
    var cart = document.getElementById("A85");
    var question = document.getElementById("dzA88") || document.getElementById("A88");
    if (account) {
      account.style.cursor = "pointer";
      account.setAttribute("title", "Mon Compte");
      account.onclick = function (e) { e.preventDefault(); window.location.href = "/mon-compte.html"; };
      var wrap = account.closest(".dzSpan"); if (wrap) wrap.style.cursor = "pointer";
    }
    if (cart) {
      cart.style.cursor = "pointer";
      cart.setAttribute("title", "Mes Commandes");
      cart.onclick = function (e) { e.preventDefault(); window.location.href = "/mes-commandes.html"; };
      var wrap2 = cart.closest(".dzSpan"); if (wrap2) wrap2.style.cursor = "pointer";
    }
    if (question) {
      var qWrap = question.closest ? (question.closest(".pos16") || question.closest(".dzSpan") || question) : question;
      qWrap.style.display = "none";
    }
    // L'icône d'engrenage ne sert qu'à remplacer le bouton "?" du menu WEBDEV
    // d'origine (slot #dzA88 sur index.html). Sur les pages modernes (Accueil-v2,
    // vitrine, etc.) la roue est déjà présente dans la barre supérieure, on ne
    // doit donc rien injecter ici pour éviter un bouton flottant en bas de page.
    var qSlot = document.getElementById("dzA88");
    if (qSlot && qSlot.parentNode && !document.getElementById("magma-settings-icon")) {
      var settings = document.createElement("button");
      settings.id = "magma-settings-icon";
      settings.type = "button";
      settings.title = "Paramètres";
      settings.setAttribute("aria-label", "Paramètres");
      settings.innerHTML = "⚙";
      qSlot.parentNode.style.display = "";
      qSlot.style.display = "none";
      qSlot.parentNode.appendChild(settings);
      settings.addEventListener("click", openSettingsModal);
    }
    // Sécurité : si une version précédente avait déjà ajouté le bouton au body,
    // on le retire pour ne plus le voir en bas de page.
    var stale = document.getElementById("magma-settings-icon");
    if (stale && stale.parentNode === document.body) {
      stale.parentNode.removeChild(stale);
    }
  }

  function applyAdminRoleUi() {
    if (!document.getElementById("admin-dashboard")) return;
    var rolePromise = window.MAGMA_ADMIN_ROLE
      ? Promise.resolve({ role: window.MAGMA_ADMIN_ROLE })
      : fetch("/api/admin/status").then(function (r) { return r.json(); });
    rolePromise.then(function (st) {
      var role = (st && st.role) || "normal";
      var dlNav = document.querySelector('#admin-dashboard .nav-item[data-section="downloads"]');
      var dlSection = document.getElementById("section-downloads");
      if (role !== "super") {
        if (dlNav) dlNav.style.display = "none";
        if (dlSection) dlSection.style.display = "none";
        var rwNav = document.querySelector('#admin-dashboard .nav-item[data-section="downloads-railway"]');
        if (rwNav) rwNav.remove();
        var rwSec = document.getElementById("section-downloads-railway");
        if (rwSec) rwSec.remove();
        var rdNav = document.querySelector('#admin-dashboard .nav-item[data-section="downloads-render"]');
        if (rdNav) rdNav.remove();
        var rdSec = document.getElementById("section-downloads-render");
        if (rdSec) rdSec.remove();
        return;
      }
      if (dlNav) dlNav.style.display = "";
      if (dlSection) dlSection.style.display = "";
      var nav = document.querySelector("#admin-dashboard .sidebar-nav");
      if (nav && !document.querySelector('#admin-dashboard .nav-item[data-section="downloads-railway"]')) {
        var item = document.createElement("div");
        item.className = "nav-item";
        item.setAttribute("data-section", "downloads-railway");
        item.innerHTML = '<span class="icon">🚄</span><span>Télécharger version Railway</span>';
        nav.appendChild(item);
      }
      var main = document.querySelector("#admin-dashboard .main-content") || document.getElementById("admin-dashboard");
      if (main && !document.getElementById("section-downloads-railway")) {
        var sec = document.createElement("div");
        sec.className = "section";
        sec.id = "section-downloads-railway";
        sec.style.display = "none";
        sec.innerHTML =
          '<div class="page-header"><div><h2>Télécharger version Railway</h2>' +
          '<p>Archive prête à déployer sur Railway (Procfile, railway.json, nixpacks.toml inclus).</p></div></div>' +
          '<div class="card">' +
            '<h3>Code source — version Railway</h3>' +
            '<p style="font-size:13px;color:#888;margin-bottom:20px;">Cette archive ZIP contient le projet sans les fichiers spécifiques à Replit, prêt à être déployé sur Railway.</p>' +
            '<a href="/api/source-railway.zip" class="download-card" style="border-color:#6b46ff;">' +
              '<div class="dl-icon" style="font-size:32px;">🚄</div>' +
              '<div class="dl-info"><strong>librairie-magma-railway.zip</strong>' +
              '<small>Configuration Railway incluse — déploiement en un clic</small></div>' +
            '</a>' +
          '</div>';
        main.appendChild(sec);
      }
      var newNav = document.querySelector('#admin-dashboard .nav-item[data-section="downloads-railway"]');
      if (newNav && !newNav._wired) {
        newNav._wired = true;
        newNav.addEventListener("click", function () {
          document.querySelectorAll("#admin-dashboard .nav-item").forEach(function (n) { n.classList.remove("active"); });
          newNav.classList.add("active");
          document.querySelectorAll("#admin-dashboard .section").forEach(function (s) { s.style.display = "none"; });
          var s = document.getElementById("section-downloads-railway");
          if (s) s.style.display = "block";
        });
      }

      // ---- Render deployment (super admin only) ----
      if (nav && !document.querySelector('#admin-dashboard .nav-item[data-section="downloads-render"]')) {
        var itemR = document.createElement("div");
        itemR.className = "nav-item";
        itemR.setAttribute("data-section", "downloads-render");
        itemR.innerHTML = '<span class="icon">🟣</span><span>Télécharger version Render</span>';
        nav.appendChild(itemR);
      }
      if (main && !document.getElementById("section-downloads-render")) {
        var secR = document.createElement("div");
        secR.className = "section";
        secR.id = "section-downloads-render";
        secR.style.display = "none";
        secR.innerHTML =
          '<div class="page-header"><div><h2>Télécharger version Render</h2>' +
          '<p>Archive prête à déployer sur Render (render.yaml, Procfile, README inclus).</p></div></div>' +
          '<div class="card">' +
            '<h3>Code source — version Render</h3>' +
            '<p style="font-size:13px;color:#888;margin-bottom:20px;">Cette archive ZIP contient le projet sans les fichiers spécifiques à Replit, prêt à être déployé sur Render.</p>' +
            '<a href="/api/source-render.zip" class="download-card" style="border-color:#46b3ff;">' +
              '<div class="dl-icon" style="font-size:32px;">🟣</div>' +
              '<div class="dl-info"><strong>librairie-magma-render.zip</strong>' +
              '<small>Configuration Render incluse — render.yaml prêt à l\'emploi</small></div>' +
            '</a>' +
            '<div style="margin-top:18px;padding:14px;background:#f7f9ff;border-radius:8px;font-size:13px;color:#444;line-height:1.6;">' +
              '<strong>Étapes rapides :</strong><br>' +
              '1. Téléchargez l\'archive et envoyez-la sur GitHub.<br>' +
              '2. Sur <a href="https://render.com" target="_blank" rel="noopener">render.com</a> → New + → Web Service → connectez le dépôt.<br>' +
              '3. Render lit <code>render.yaml</code> automatiquement (build : npm install, start : node server.js).<br>' +
              '5. Pour persister la base SQLite, ajoutez un Disk monté sur <code>/opt/render/project/src/data</code>.' +
            '</div>' +
          '</div>';
        main.appendChild(secR);
      }
      var newNavR = document.querySelector('#admin-dashboard .nav-item[data-section="downloads-render"]');
      if (newNavR && !newNavR._wired) {
        newNavR._wired = true;
        newNavR.addEventListener("click", function () {
          document.querySelectorAll("#admin-dashboard .nav-item").forEach(function (n) { n.classList.remove("active"); });
          newNavR.classList.add("active");
          document.querySelectorAll("#admin-dashboard .section").forEach(function (s) { s.style.display = "none"; });
          var s = document.getElementById("section-downloads-render");
          if (s) s.style.display = "block";
        });
      }
    }).catch(function () {});
  }

  function watchAdminDashboard() {
    if (document.getElementById("admin-dashboard")) { applyAdminRoleUi(); return; }
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (document.getElementById("admin-dashboard") && document.getElementById("admin-dashboard").style.display !== "none") {
        applyAdminRoleUi();
      }
      if (tries > 80) clearInterval(iv);
    }, 500);
  }

  function watchAdminLoginRedirect() {
    // On /Admin.html (login gate): when login succeeds, redirect to role-specific dashboard.
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var p = origFetch.apply(this, arguments);
      if (url.indexOf("/api/admin/login") !== -1) {
        p.then(function (resp) {
          if (resp && resp.ok) {
            try {
              resp.clone().json().then(function (j) {
                var role = j && j.role;
                setTimeout(function () {
                  window.location.replace(role === "super" ? "/super-admin.html" : "/admin.html");
                }, 50);
              });
            } catch (e) {}
          }
        }).catch(function () {});
      }
      return p;
    };
  }


  function showAdNotification(ad) {
    var existing = document.getElementById("magma-ad-toast");
    if (existing) existing.remove();
    var box = document.createElement("div");
    box.id = "magma-ad-toast";
    box.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:999998;max-width:340px;background:#fff;border-left:4px solid #ff690c;border-radius:10px;box-shadow:0 18px 45px rgba(0,0,0,.22);padding:14px 16px 14px 18px;font-family:Arial,sans-serif;color:#2b293a;opacity:0;transform:translateY(12px);transition:opacity .3s,transform .3s;";
    var title = ad.title || ad.titre || "Promotion";
    var message = ad.message || "";
    var link = ad.link || "";
    var html = '<button type="button" id="magma-ad-close" aria-label="Fermer" style="position:absolute;top:6px;right:8px;background:transparent;border:0;font-size:18px;color:#888;cursor:pointer;line-height:1;">×</button>'
      + '<div style="font-size:11px;font-weight:700;color:#ff690c;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px;">📣 Annonce</div>'
      + '<div style="font-size:15px;font-weight:700;margin-bottom:4px;padding-right:16px;">' + esc(title) + '</div>'
      + (message ? '<div style="font-size:13px;color:#555;line-height:1.4;">' + esc(message) + '</div>' : '');
    if (link) {
      html += '<a href="' + esc(link) + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;background:#ff690c;color:#fff;font-size:12px;font-weight:700;text-decoration:none;padding:7px 12px;border-radius:999px;">En savoir plus</a>';
    }
    box.innerHTML = html;
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.style.opacity = "1"; box.style.transform = "translateY(0)"; });
    function dismiss() {
      box.style.opacity = "0";
      box.style.transform = "translateY(12px)";
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 300);
    }
    document.getElementById("magma-ad-close").addEventListener("click", dismiss);
    setTimeout(dismiss, 9000);
  }

  function startAdRotator() {
    var lastId = null;
    function tick() {
      fetch("/api/ads", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (ads) {
          if (!Array.isArray(ads) || ads.length === 0) return;
          var pool = ads.length > 1 ? ads.filter(function (a) { return a.id !== lastId; }) : ads;
          var ad = pool[Math.floor(Math.random() * pool.length)];
          lastId = ad.id;
          showAdNotification(ad);
        })
        .catch(function () {});
    }
    setTimeout(tick, 5000 + Math.floor(Math.random() * 4000));
    setInterval(tick, 30000 + Math.floor(Math.random() * 15000));
  }

  function setupResponsiveTopbar() {
    var topbar = document.querySelector(".topbar");
    if (!topbar) return;
    var nav = topbar.querySelector(".topbar-nav");

    // Créer l'overlay s'il n'existe pas déjà
    var overlay = document.getElementById("magma-nav-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "magma-nav-overlay";
      overlay.className = "magma-nav-overlay";
      document.body.appendChild(overlay);
    }

    if (!topbar.querySelector(".menu-toggle")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-toggle";
      btn.setAttribute("aria-label", "Ouvrir le menu");
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
      var logo = topbar.querySelector(".logo");
      if (logo && logo.nextSibling) topbar.insertBefore(btn, logo.nextSibling);
      else topbar.appendChild(btn);

      function toggleMenu() {
        if (!nav) return;
        var open = nav.classList.toggle("is-open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        document.body.classList.toggle("magma-menu-open", open);
        overlay.classList.toggle("is-active", open);
        
        // Copier les liens de la sous-barre dans le menu mobile si ce n'est pas fait
        if (open && window.innerWidth <= 980 && !nav.dataset.subnavInjected) {
          nav.dataset.subnavInjected = "true";
          var subnavLinks = [
            {href: "/Formulaire.html", text: "Devenir vendeur"},
            {href: "/catalogue.html", text: "Produit"},
            {href: "/meilleures-ventes.html", text: "Meilleures ventes"},
            {href: "/categories.html", text: "Catégories"},
            {href: "/boutiques.html", text: "Boutiques"}
          ];
          var div = document.createElement("div");
          div.style.cssText = "height: 1px; background: rgba(255,255,255,.1); margin: 15px 22px 5px;";
          nav.appendChild(div);
          subnavLinks.forEach(function(l) {
            var a = document.createElement("a");
            a.href = l.href;
            a.textContent = l.text;
            nav.appendChild(a);
          });
        }
      }

      btn.addEventListener("click", toggleMenu);
      overlay.addEventListener("click", toggleMenu);
    }
  }

  // ===== Sous-barre noire commune (Devenir vendeur, Produit, …) =====
  // Injectée juste sous le header sur toutes les pages publiques pour garder
  // une cohérence visuelle. Reprend le menu d'origine WEBDEV (index.html).
  function injectGlobalSubNav() {
    if (document.getElementById("magma-subnav")) return;
    // Évite la duplication sur les pages WEBDEV qui possèdent déjà cette nav
    // native (index.html, MABOUTIQUE.html, etc.)
    if (document.querySelector("nav.wbMenuMain, .wbMenuMain")) return;

    // Styles auto-portés (les pages vitrine/Accueil-v2 n'incluent pas magma-fixes.css)
    if (!document.getElementById("magma-subnav-style")) {
      var style = document.createElement("style");
      style.id = "magma-subnav-style";
      style.textContent =
        '#magma-subnav{background:#1f1d2c;width:100%;border-bottom:1px solid rgba(255,255,255,.08);' +
          'font-family:Verdana,Arial,Helvetica,sans-serif;position:relative;z-index:90;}' +
        '#magma-subnav .magma-subnav-inner{max-width:1200px;margin:0 auto;padding:0 24px;display:flex;' +
          'align-items:center;gap:28px;height:42px;overflow-x:auto;scrollbar-width:none;}' +
        '#magma-subnav .magma-subnav-inner::-webkit-scrollbar{display:none;}' +
        '#magma-subnav .magma-subnav-link{color:#fff !important;font-size:13px;font-weight:600;' +
          'text-decoration:none;white-space:nowrap;padding:6px 0;letter-spacing:.2px;opacity:.92;' +
          'transition:color .15s,opacity .15s;}' +
        '#magma-subnav .magma-subnav-link:hover{color:#ff690c !important;opacity:1;}' +
        '@media (max-width:640px){' +
          '#magma-subnav .magma-subnav-inner{padding:0 14px;gap:18px;height:40px;}' +
          '#magma-subnav .magma-subnav-link{font-size:12.5px;}' +
        '}';
      document.head.appendChild(style);
    }

    var bar = document.createElement("nav");
    bar.id = "magma-subnav";
    bar.setAttribute("aria-label", "Navigation secondaire");
    bar.innerHTML =
      '<div class="magma-subnav-inner">' +
        '<a class="magma-subnav-link" href="/Formulaire.html">Devenir vendeur</a>' +
        '<a class="magma-subnav-link" href="/catalogue.html">Produit</a>' +
        '<a class="magma-subnav-link" href="/meilleures-ventes.html">Meilleures ventes</a>' +
        '<a class="magma-subnav-link" href="/categories.html">Catégories</a>' +
        '<a class="magma-subnav-link" href="/boutiques.html">Boutiques</a>' +
      '</div>';

    // Insertion : juste après le header personnalisé (.topbar) si présent,
    // sinon en tout début de body pour les pages WEBDEV exportées.
    var topbar = document.querySelector("header.topbar");
    if (topbar && topbar.parentNode) {
      topbar.parentNode.insertBefore(bar, topbar.nextSibling);
    } else {
      document.body.insertBefore(bar, document.body.firstChild);
    }
  }

  // ===== Footer : adapter le lien Connexion / Déconnexion =====
  // Sur tous les pieds de page du projet, transformer automatiquement le lien
  // "Connexion" en "Déconnexion" (vers /auth/logout) lorsque l'utilisateur est
  // déjà authentifié. Met également à jour les liens du panier hérités
  // (/Mon-panier.html) vers la nouvelle page /panier.html.
  function updateFooterAuthLink() {
    // Normalise d'abord les liens "Mon panier" hérités (sécurité côté client)
    // Couvre header, nav, footer et liens d'icônes : tout lien pointant vers
    // /Mon-panier.html est ré-écrit vers la page panier moderne /panier.html.
    document.querySelectorAll('a[href="/Mon-panier.html"], a[href="Mon-panier.html"]').forEach(function (a) {
      a.setAttribute("href", "/panier.html");
    });
    fetch("/api/auth/status", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !s.authenticated) return;
        // Recherche tout lien dans un footer pointant vers /login.html OU
        // dont le texte contient "Connexion" (insensible à la casse).
        var anchors = document.querySelectorAll("footer a");
        anchors.forEach(function (a) {
          var href = (a.getAttribute("href") || "").toLowerCase();
          var txt = (a.textContent || "").trim().toLowerCase();
          var isLoginLink = href.indexOf("/login") !== -1 || href.indexOf("login.html") !== -1;
          var isLoginText = txt === "connexion" || txt === "se connecter";
          if (isLoginLink || isLoginText) {
            a.setAttribute("href", "/auth/logout");
            a.textContent = "Déconnexion";
            a.setAttribute("title", "Fermer ma session");
          }
        });
      })
      .catch(function () {});
  }

  // Bouton de déconnexion accessible sur mobile dans le tableau admin
  // (la sidebar-footer est masquée sur écran étroit pour gagner de la place).
  function injectAdminMobileLogout() {
    if (document.getElementById("admin-mobile-logout")) return;
    var dash = document.getElementById("admin-dashboard");
    if (!dash) return;
    var btn = document.createElement("button");
    btn.id = "admin-mobile-logout";
    btn.type = "button";
    btn.textContent = "Déconnexion";
    btn.addEventListener("click", function () {
      var orig = document.getElementById("admin-logout-btn");
      if (orig) orig.click();
    });
    document.body.appendChild(btn);
  }

  function init() {
    applyTheme();
    setupResponsiveTopbar();
    var page = pageName();
    if (!isAdminAreaPage() && page !== "login" && page !== "register" && page !== "reset") {
      injectGlobalSubNav();
      updateFooterAuthLink();
    }
    // Nettoyage : si une ancienne version a laissé une pastille engrenage
    // flottante en bas de la page, on la retire (l'icône Paramètres existe
    // déjà dans la barre supérieure des pages modernes).
    var floatGear = document.getElementById("magma-settings-icon");
    if (floatGear && floatGear.parentNode === document.body) {
      floatGear.parentNode.removeChild(floatGear);
    }
    if (page === "admin") {
      [200, 800, 2000].forEach(function (d) { setTimeout(injectAdminMobileLogout, d); });
    }
    if (!isAdminAreaPage() && page !== "reset") addAdminLink();
    if (!isAdminAreaPage() && page !== "login" && page !== "register" && page !== "reset") startAdRotator();
    if (page === "admin-login") watchAdminLoginRedirect();
    if (page === "admin") {
      watchAdminDashboard();
    }
    if (page === "home") wireHomeIcons();
    if (page !== "login" && page !== "register" && page !== "reset" && !isAdminAreaPage()) updateCartBadge();
    if (page === "home") initHome();
    if (page === "cart") initCart();
    if (page === "detail") initDetail();
    
    
    if (page === "boutique") initAdmin();
    if (page === "admin" && !document.getElementById("admin-dashboard")) initAdmin();
    if (page === "add") initLegacyAdd();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  /* === AUTOCOMPLÉTION === */
  (function initAutocomplete(){
    const inputs = document.querySelectorAll('input[name="q"], #hdr-search, input[type="search"]');
    if(!inputs.length) return;
    
    const style = document.createElement('style');
    style.textContent = `
      .magma-ac { position:absolute; background:#fff; border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,.12); z-index:9999; max-height:400px; overflow-y:auto; width:100%; top:calc(100% + 4px); left:0; border:1px solid #eee; display:none; }
      html[data-magma-theme="dark"] .magma-ac { background:#1e1e1e; border-color:#333; }
      .magma-ac-item { display:flex; gap:12px; padding:10px 14px; text-decoration:none; color:inherit; border-bottom:1px solid #fafafa; align-items:center; transition:background .15s; }
      html[data-magma-theme="dark"] .magma-ac-item { border-color:#2a2a2a; }
      .magma-ac-item:hover { background:#fcfcfc; }
      html[data-magma-theme="dark"] .magma-ac-item:hover { background:#2a2a2a; }
      .magma-ac-img { width:32px; height:44px; object-fit:cover; border-radius:4px; background:#f0f0f0; }
      .magma-ac-info { flex:1; min-width:0; }
      .magma-ac-title { font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px; }
      .magma-ac-author { font-size:11px; color:#888; }
      .magma-ac-price { font-size:12px; font-weight:700; color:#ff690c; white-space:nowrap; }
    `;
    document.head.appendChild(style);

    inputs.forEach(input => {
      const parent = input.parentElement;
      parent.style.position = 'relative';
      const list = document.createElement('div');
      list.className = 'magma-ac';
      parent.appendChild(list);

      let debounceTimer;
      input.addEventListener('input', function(e) {
        clearTimeout(debounceTimer);
        const q = e.target.value.trim().toLowerCase();
        if(q.length < 2) { list.style.display = 'none'; return; }
        
        debounceTimer = setTimeout(() => {
          fetch('/api/books')
            .then(r => r.json())
            .then(books => {
              const matches = books.filter(b => (b.titre||'').toLowerCase().includes(q) || (b.auteur||'').toLowerCase().includes(q)).slice(0, 5);
              if(matches.length === 0) { list.style.display = 'none'; return; }
              
              list.innerHTML = matches.map(b => `
                <a href="/PI_Produit.html?id=${b.id}" class="magma-ac-item">
                  <img class="magma-ac-img" src="${b.image || 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 130%22><rect width=%22100%22 height=%22130%22 fill=%22%23eee%22/></svg>'}" alt="">
                  <div class="magma-ac-info">
                    <div class="magma-ac-title">${esc(b.titre)}</div>
                    <div class="magma-ac-author">${esc(b.auteur)}</div>
                  </div>
                  <div class="magma-ac-price">${money(b.prix)}</div>
                </a>
              `).join('');
              list.style.display = 'block';
            }).catch(()=>{});
        }, 300);
      });

      document.addEventListener('click', e => {
        if(!parent.contains(e.target)) list.style.display = 'none';
      });
      input.addEventListener('focus', () => {
        if(input.value.length >= 2 && list.innerHTML !== '') list.style.display = 'block';
      });
    });
  })();
  /* === WISHLIST === */
  (function initWishlist(){
    document.addEventListener('click', e => {
      const btn = e.target.closest('.wishlist-btn');
      if(!btn) return;
      e.preventDefault(); e.stopPropagation();
      const id = btn.dataset.id;
      const ico = btn.querySelector('.ico');
      fetch('/api/wishlist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      }).then(r => {
        if(r.status === 401) { window.location.href = '/login.html'; throw new Error("unauth"); }
        return r.json();
      }).then(res => {
        if(res.added) {
          btn.classList.add('active');
          if(ico) ico.textContent = '❤️';
        } else {
          btn.classList.remove('active');
          if(ico) ico.textContent = '🤍';
        }
      }).catch(()=>{});
    });
    fetch('/api/wishlist').then(r=>r.ok?r.json():[]).then(list=>{
      const ids = list.map(b=>Number(b.id));
      document.querySelectorAll('.wishlist-btn').forEach(btn => {
        if(ids.includes(Number(btn.dataset.id))) {
          btn.classList.add('active');
          btn.innerHTML = '<span class="ico">❤️</span>';
        }
      });
    }).catch(()=>{});
  })();


  // --- Améliorations UX ---
  if (!document.getElementById('magma-ux-styles')) {
    var style = document.createElement('style');
    style.id = 'magma-ux-styles';
    style.innerHTML = `
      /* --- WhatsApp Button --- */
      #magma-whatsapp-btn { position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px; background: #25D366; border-radius: 50%; box-shadow: 0 4px 15px rgba(37,211,102,0.4); display: flex; align-items: center; justify-content: center; color: white; text-decoration: none; z-index: 9999; animation: wa-pulse 2s infinite; transition: transform 0.3s; }
      #magma-whatsapp-btn:hover { transform: scale(1.1); }
      @keyframes wa-pulse { 0% { box-shadow: 0 0 0 0 rgba(37,211,102,0.6); } 70% { box-shadow: 0 0 0 15px rgba(37,211,102,0); } 100% { box-shadow: 0 0 0 0 rgba(37,211,102,0); } }
      /* --- Skeletons --- */
      .skeleton { background: #f0f0f0; border-radius: 8px; overflow: hidden; position: relative; }
      .skeleton::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent); animation: skeleton-shimmer 1.5s infinite; }
      @keyframes skeleton-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
      /* --- Mini-Cart (Drawer) --- */
      #magma-minicart-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; opacity: 0; visibility: hidden; transition: all 0.3s ease; }
      #magma-minicart-overlay.open { opacity: 1; visibility: visible; }
      #magma-minicart-drawer { position: fixed; top: 0; right: -400px; width: 100%; max-width: 400px; height: 100vh; background: #fff; z-index: 10001; box-shadow: -5px 0 25px rgba(0,0,0,0.1); display: flex; flex-direction: column; transition: right 0.3s ease; }
      #magma-minicart-drawer.open { right: 0; }
      .minicart-header { padding: 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
      .minicart-header h3 { margin: 0; font-size: 18px; color: #2b293a; }
      .minicart-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #888; }
      .minicart-body { flex: 1; overflow-y: auto; padding: 20px; }
      .minicart-footer { padding: 20px; border-top: 1px solid #eee; background: #fafafa; }
      .minicart-footer .total { display: flex; justify-content: space-between; font-size: 18px; font-weight: 700; color: #2b293a; margin-bottom: 16px; }
      .minicart-footer .btn-checkout { display: block; width: 100%; padding: 14px; background: #ff690c; color: #fff; text-align: center; border-radius: 8px; font-weight: 700; text-decoration: none; }
      .minicart-item { display: flex; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #eee; }
      .minicart-item img { width: 60px; height: 80px; object-fit: cover; border-radius: 4px; }
      .minicart-item-info { flex: 1; }
      .minicart-item-title { font-weight: 700; font-size: 14px; color: #2b293a; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .minicart-item-price { font-size: 13px; color: #ff690c; font-weight: 700; }
      .minicart-item-qty { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .minicart-item-qty button { background: #eee; border: none; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
      .minicart-item-remove { color: #b42318; font-size: 12px; border: none; background: none; cursor: pointer; text-decoration: underline; margin-top: 8px; }
      html[data-magma-theme="dark"] #magma-minicart-drawer { background: #1a1a24; }
      html[data-magma-theme="dark"] .minicart-header h3, html[data-magma-theme="dark"] .minicart-footer .total, html[data-magma-theme="dark"] .minicart-item-title { color: #fff; }
      html[data-magma-theme="dark"] .minicart-header, html[data-magma-theme="dark"] .minicart-footer, html[data-magma-theme="dark"] .minicart-item { border-color: #333; }
      html[data-magma-theme="dark"] .minicart-footer { background: #25252f; }
    `;
    document.head.appendChild(style);
  }

  // 1. WhatsApp Floating Button
  function injectWhatsApp() {
    if (document.getElementById('magma-whatsapp-btn')) return;
    var a = document.createElement('a');
    a.id = 'magma-whatsapp-btn';
    a.href = 'https://wa.me/242064280982';
    a.target = '_blank';
    a.title = 'Contactez-nous sur WhatsApp';
    a.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>';
    document.body.appendChild(a);
  }

  // 2. Mini-Cart
  function injectMiniCart() {
    if (document.getElementById('magma-minicart-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'magma-minicart-overlay';
    var drawer = document.createElement('div');
    drawer.id = 'magma-minicart-drawer';
    drawer.innerHTML = 
      '<div class="minicart-header">' +
        '<h3>Mon Panier</h3>' +
        '<button class="minicart-close">&times;</button>' +
      '</div>' +
      '<div class="minicart-body" id="minicart-items">' +
        '<div style="text-align:center;color:#888;padding:40px 0;">Chargement...</div>' +
      '</div>' +
      '<div class="minicart-footer">' +
        '<div class="total"><span>Total :</span> <span id="minicart-total">0 FCFA</span></div>' +
        '<a href="/panier.html" class="btn-checkout">Passer la commande</a>' +
      '</div>';
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    var closeBtn = drawer.querySelector('.minicart-close');
    var closeFn = function() {
      overlay.classList.remove('open');
      drawer.classList.remove('open');
    };
    closeBtn.addEventListener('click', closeFn);
    overlay.addEventListener('click', closeFn);
  }

  window.openMiniCart = function() {
    injectMiniCart();
    document.getElementById('magma-minicart-overlay').classList.add('open');
    document.getElementById('magma-minicart-drawer').classList.add('open');
    refreshMiniCart();
  };

  function refreshMiniCart() {
    var itemsContainer = document.getElementById('minicart-items');
    var totalEl = document.getElementById('minicart-total');
    if (!itemsContainer) return;
    fetch('/api/cart').then(r => r.ok ? r.json() : []).then(items => {
      if (items.length === 0) {
        itemsContainer.innerHTML = '<div style="text-align:center;color:#888;padding:40px 0;">Votre panier est vide</div>';
        totalEl.textContent = '0 FCFA';
        return;
      }
      var html = '';
      var total = 0;
      items.forEach(item => {
        var sub = Number(item.prix) * Number(item.qty);
        total += sub;
        var img = item.image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130"><rect width="100" height="130" fill="%23eee"/></svg>';
        html += `
          <div class="minicart-item">
            <img src="${item.image || ''}" alt="">
            <div class="minicart-item-info">
              <div class="minicart-item-title">${item.titre || 'Livre'}</div>
              <div class="minicart-item-price">${item.prix} FCFA</div>
              <div class="minicart-item-qty">
                <button onclick="updateCartItemQty(${item.id}, ${item.qty - 1})">-</button>
                <span>${item.qty}</span>
                <button onclick="updateCartItemQty(${item.id}, ${item.qty + 1})">+</button>
              </div>
              <button class="minicart-item-remove" onclick="updateCartItemQty(${item.id}, 0)">Supprimer</button>
            </div>
          </div>`;
      });
      itemsContainer.innerHTML = html;
      totalEl.textContent = money(total);
    }).catch(e => {
      itemsContainer.innerHTML = '<div style="text-align:center;color:#b42318;padding:40px 0;">Erreur de chargement</div>';
    });
  }

  window.updateCartItemQty = function(id, qty) {
    if (qty <= 0) {
      post('/api/cart/remove', { id: id }).then(() => {
        refreshMiniCart();
        if(window.updateCartBadge) window.updateCartBadge();
        if(window.loadCartItems) window.loadCartItems();
      });
    } else {
      post('/api/cart/update', { id: id, qty: qty }).then(() => {
        refreshMiniCart();
        if(window.updateCartBadge) window.updateCartBadge();
        if(window.loadCartItems) window.loadCartItems();
      });
    }
  };

  // Intercept Add to Cart clicks globally
  document.addEventListener('click', function(e) {
    var addBtn = e.target.closest('.add-cart, .add');
    if (addBtn && (addBtn.hasAttribute('data-bookid') || addBtn.hasAttribute('data-id'))) {
      e.preventDefault();
      e.stopPropagation();
      var id = addBtn.getAttribute('data-bookid') || addBtn.getAttribute('data-id');
      var orig = addBtn.textContent;
      addBtn.disabled = true;
      addBtn.textContent = '...';
      post('/api/cart/add', { id: Number(id), qty: 1 }).then(() => {
        addBtn.textContent = '✓ Ajouté';
        if(window.updateCartBadge) window.updateCartBadge();
        window.openMiniCart();
        setTimeout(() => { addBtn.textContent = orig; addBtn.disabled = false; }, 1500);
      }).catch(err => {
        if (err && err.status === 401) {
          window.location.href = '/login.html';
        } else {
          addBtn.textContent = 'Erreur';
          setTimeout(() => { addBtn.textContent = orig; addBtn.disabled = false; }, 1500);
        }
      });
    }
    
    // Intercept header cart icon click
    var cartLink = e.target.closest('a[href="/panier.html"]');
    if (cartLink && !cartLink.classList.contains('btn-checkout') && pageName() !== 'cart') {
      e.preventDefault();
      window.openMiniCart();
    }
  });

  // 3. Quick View Modal
  function injectQuickView() {
    if (document.getElementById('magma-quickview-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'magma-quickview-modal';
    modal.innerHTML = `
      <div class="quickview-content">
        <button class="quickview-close">&times;</button>
        <div class="quickview-img"><img id="qv-img" src="" alt=""></div>
        <div class="quickview-info">
          <div class="quickview-title" id="qv-title">...</div>
          <div class="quickview-author" id="qv-author">...</div>
          <div class="quickview-price" id="qv-price">...</div>
          <div class="quickview-desc" id="qv-desc">...</div>
          <div class="quickview-actions">
            <button class="btn-orange add-cart" id="qv-addbtn" style="flex:1;padding:14px;border:none;border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;">Ajouter au panier</button>
            <button class="wishlist-btn" id="qv-wishbtn" style="width:50px;height:50px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer;font-size:24px;color:#ff690c;"><span class="ico">🤍</span></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    
    modal.querySelector('.quickview-close').addEventListener('click', function() {
      modal.classList.remove('open');
    });
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  window.openQuickView = function(e, id) {
    e.preventDefault();
    e.stopPropagation();
    // injectQuickView();
    var modal = document.getElementById('magma-quickview-modal');
    modal.classList.add('open');
    document.getElementById('qv-title').textContent = 'Chargement...';
    get('/api/books/' + id).then(b => {
      document.getElementById('qv-img').src = b.image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130"><rect width="100" height="130" fill="%23eee"/></svg>';
      document.getElementById('qv-title').textContent = b.titre;
      document.getElementById('qv-author').textContent = b.auteur || 'Auteur inconnu';
      document.getElementById('qv-price').textContent = money(b.prix);
      document.getElementById('qv-desc').innerHTML = (b.description || 'Aucune description').replace(/\n/g, '<br>');
      
      var addBtn = document.getElementById('qv-addbtn');
      addBtn.setAttribute('data-bookid', b.id);
      
      var wishBtn = document.getElementById('qv-wishbtn');
      wishBtn.setAttribute('data-id', b.id);
      
      fetch('/api/wishlist').then(r=>r.ok?r.json():[]).then(list=>{
        const ids = list.map(item=>Number(item.id));
        if(ids.includes(Number(b.id))) {
          wishBtn.classList.add('active');
          wishBtn.innerHTML = '<span class="ico">❤️</span>';
        } else {
          wishBtn.classList.remove('active');
          wishBtn.innerHTML = '<span class="ico">🤍</span>';
        }
      }).catch(()=>{});
    }).catch(e => {
      document.getElementById('qv-title').textContent = 'Erreur';
    });
  };

  document.addEventListener('DOMContentLoaded', function() {
    injectWhatsApp();
    injectMiniCart();
    // injectQuickView();
  });
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectWhatsApp();
    injectMiniCart();
    // injectQuickView();
  }
})();
