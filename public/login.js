const state = {
  config: null,
};

function setMessage(text, ok = false) {
  const el = document.querySelector("#authMessage");
  el.textContent = text || "";
  el.style.color = ok ? "#2f7a4f" : "#9e3e3e";
}

function setMode(mode) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  document.querySelector("#loginForm").classList.toggle("active", mode === "login");
  document.querySelector("#registerForm").classList.toggle("active", mode === "register");
  setMessage("");
}

async function readJsonResponse(response, fallbackMessage = "İşlem başarısız.") {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`${fallbackMessage} Sunucu JSON yerine farklı bir cevap döndü (${response.status}). ${preview}`);
  }
  if (!response.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJsonResponse(response, "İşlem başarısız.");
}

async function loadConfig() {
  const response = await fetch("/api/auth/config");
  state.config = await readJsonResponse(response, "Ayarlar alınamadı.");
  document.querySelector("[data-mode='register']").hidden = !state.config.registrationAllowed;
  document.querySelector("#inviteWrap").hidden = !state.config.inviteRequired;
  if (state.config.firstUser) {
    setMode("register");
    setMessage("İlk kullanıcı admin olarak oluşturulacak.", true);
  }
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });
}

function wireForms() {
  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await postJson("/api/login", {
        email: document.querySelector("#loginEmail").value,
        password: document.querySelector("#loginPassword").value,
      });
      window.location.href = "/";
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.querySelector("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await postJson("/api/register", {
        fullName: document.querySelector("#registerName").value,
        email: document.querySelector("#registerEmail").value,
        password: document.querySelector("#registerPassword").value,
        inviteCode: document.querySelector("#inviteCode").value,
      });
      window.location.href = "/";
    } catch (error) {
      setMessage(error.message);
    }
  });
}

async function boot() {
  wireTabs();
  wireForms();
  await loadConfig();
}

boot();
