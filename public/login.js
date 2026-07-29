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

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "İşlem başarısız.");
  return data;
}

async function loadConfig() {
  const response = await fetch("/api/auth/config");
  state.config = await response.json();
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
