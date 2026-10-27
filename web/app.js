
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $ = id => document.getElementById(id);

const userId = String(tg?.initDataUnsafe?.user?.id || "");

let balance = 1000;
let bet = 100;
let phase = "waiting";
let multiplier = 1;
let activeBet = 0;
let cashedOut = false;
let history = [];
let round = 1;
let busy = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "РћС€РёР±РєР° СЃРµСЂРІРµСЂР°");
  }

  return data;
}

function money(value) {
  return Math.floor(value).toLocaleString("ru-RU");
}

function showMessage(message) {
  $("hint").textContent = message;
}

function render() {
  $("balance").textContent = money(balance);
  $("betAmount").value = bet;
  $("roundNumber").textContent = "#" + String(round).padStart(3, "0");
  $("multiplier").textContent = multiplier.toFixed(2) + "x";

  $("roundStatus").textContent =
    phase === "waiting" ? "РћР–РР”РђРќРР• Р РђРЈРќР”Рђ" :
    phase === "flying" ? "Р РђРљР•РўРђ Р’ РџРћР›РЃРўР•" : "Р РђРЈРќР” Р—РђР’Р•Р РЁРЃРќ";

  $("gameCaption").textContent =
    phase === "waiting" ? "РЎРґРµР»Р°Р№ СЃС‚Р°РІРєСѓ РґРѕ Р·Р°РїСѓСЃРєР°" :
    phase === "flying" ? "РЈСЃРїРµР№ Р·Р°Р±СЂР°С‚СЊ РІРёСЂС‚СѓР°Р»СЊРЅС‹Р№ РІС‹РёРіСЂС‹С€" :
    "Р Р°СѓРЅРґ Р·Р°РІРµСЂС€С‘РЅ";

  $("actionButton").textContent =
    phase === "flying" && activeBet > 0 && !cashedOut
      ? "Р—Р°Р±СЂР°С‚СЊ " + money(activeBet * multiplier) + " CR"
      : phase === "waiting" && activeBet > 0
        ? "РЎС‚Р°РІРєР° РїСЂРёРЅСЏС‚Р°"
        : phase === "crashed" || cashedOut
          ? "РћР¶РёРґР°Р№ СЃР»РµРґСѓСЋС‰РёР№ СЂР°СѓРЅРґ"
          : "РџРѕСЃС‚Р°РІРёС‚СЊ " + money(bet) + " CR";

  $("actionButton").disabled =
    busy ||
    (phase === "waiting" && activeBet > 0) ||
    (phase === "flying" && (activeBet === 0 || cashedOut)) ||
    phase === "crashed";

  $("playerBet").textContent = activeBet
    ? "РЎС‚Р°РІРєР° " + money(activeBet) + " CR"
    : "РћР¶РёРґР°РµС‚ СЃС‚Р°РІРєСѓ";

  $("playerResult").textContent = cashedOut
    ? "Р—Р°Р±СЂР°РЅРѕ"
    : activeBet && phase === "flying"
      ? "Р’ РёРіСЂРµ"
      : "вЂ”";

  $("historyList").innerHTML = history.slice(0, 5).map(value =>
    `<span class="history-item ${value >= 2 ? "good" : "bad"}">${Number(value).toFixed(2)}x</span>`
  ).join("") || '<span class="history-item">вЂ”</span>';

  $("playerName").textContent =
    tg?.initDataUnsafe?.user?.first_name || "РўС‹";

  $("profileButton").textContent =
    (tg?.initDataUnsafe?.user?.first_name || "U").slice(0, 1).toUpperCase();

 
const progress = phase === "flying"
  ? Math.max(0, Math.min(70, (multiplier - 1) * 18))
  : 0;

const rocketX = 20 + progress;
const rocketY = 40 + progress * 1.1;

$("rocket").style.left = rocketX + "%";
$("rocket").style.bottom = rocketY + "px";

const trailEndX = 80 + progress * 2.4;
const trailEndY = 230 - progress * 1.1;
const trailStartX = 65;
const trailStartY = 250;

const trailPath =
  `M ${trailStartX} ${trailStartY} ` +
  `Q ${(trailStartX + trailEndX) / 2 - 25} ${(trailStartY + trailEndY) / 2 + 20}, ` +
  `${trailEndX} ${trailEndY}`;

$("trailPath").setAttribute("d", trailPath);
$("trailGlowPath").setAttribute("d", trailPath);

}

async function refreshState() {
  try {
    const data = await api(
      "/api/state?user_id=" + encodeURIComponent(userId)
    );

    balance = data.balance;
    phase = data.phase;
    multiplier = data.multiplier;
    round = data.round;
    activeBet = data.bet;
    cashedOut = data.cashed_out;
    history = data.history || [];

    render();
  } catch (error) {
    showMessage("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃРѕСЃС‚РѕСЏРЅРёРµ РёРіСЂС‹: " + error.message);
  }
}

$("betAmount").addEventListener("input", event => {
  bet = Math.max(1, Math.floor(Number(event.target.value) || 1));
});

$("halfButton").addEventListener("click", () => {
  bet = Math.max(1, Math.floor(bet / 2));
  render();
});

$("doubleButton").addEventListener("click", () => {
  bet = Math.min(1000000, bet * 2);
  render();
});

document.querySelectorAll("[data-amount]").forEach(button => {
  button.addEventListener("click", () => {
    bet = Number(button.dataset.amount);
    render();
  });
});

$("actionButton").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  render();

  try {
    if (phase === "waiting" && activeBet === 0) {
      const data = await api("/api/bet", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          amount: bet
        })
      });

      balance = data.balance;
      activeBet = bet;
      cashedOut = false;
      showMessage("РЎС‚Р°РІРєР° РїСЂРёРЅСЏС‚Р° СЃРµСЂРІРµСЂРѕРј.");
    } else if (phase === "flying" && activeBet > 0 && !cashedOut) {
      const data = await api("/api/cashout", {
        method: "POST",
        body: JSON.stringify({ user_id: userId })
      });

      balance = data.balance;
      cashedOut = true;
      showMessage(
        "Р—Р°Р±СЂР°РЅРѕ " + money(data.payout) +
        " CR РїСЂРё " + data.multiplier.toFixed(2) + "x"
      );
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    busy = false;
    await refreshState();
  }
});

document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach(item =>
      item.classList.toggle("active", item === button)
    );

    if (button.dataset.tab !== "game") {
      showMessage(
        button.dataset.tab === "history"
          ? "РСЃС‚РѕСЂРёСЏ СЂР°СѓРЅРґРѕРІ РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ РЅР°Рґ СЃС‚Р°РІРєРѕР№."
          : button.dataset.tab === "top"
            ? "РўР°Р±Р»РёС†Р° Р»РёРґРµСЂРѕРІ РґРѕР±Р°РІРёРј СЃР»РµРґСѓСЋС‰РёРј СЌС‚Р°РїРѕРј."
            : "РџСЂРѕС„РёР»СЊ РґРѕР±Р°РІРёРј СЃР»РµРґСѓСЋС‰РёРј СЌС‚Р°РїРѕРј."
      );
    } else {
      showMessage("Р‘Р°Р»Р°РЅСЃ Рё СЃС‚Р°РІРєРё вЂ” С‚РѕР»СЊРєРѕ РІРёСЂС‚СѓР°Р»СЊРЅС‹Рµ CR.");
    }
  });
});

refreshState();
setInterval(refreshState, 200);

