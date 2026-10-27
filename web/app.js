
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $ = id => document.getElementById(id);

const userId = String(tg?.initDataUnsafe?.user?.id || "demo");

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
    throw new Error(data.detail || "Ошибка сервера");
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
    phase === "waiting" ? "ОЖИДАНИЕ РАУНДА" :
    phase === "flying" ? "РАКЕТА В ПОЛЁТЕ" : "РАУНД ЗАВЕРШЁН";

  $("gameCaption").textContent =
    phase === "waiting" ? "Сделай ставку до запуска" :
    phase === "flying" ? "Успей забрать виртуальный выигрыш" :
    "Раунд завершён";

  $("actionButton").textContent =
    phase === "flying" && activeBet > 0 && !cashedOut
      ? "Забрать " + money(activeBet * multiplier) + " CR"
      : phase === "waiting" && activeBet > 0
        ? "Ставка принята"
        : phase === "crashed" || cashedOut
          ? "Ожидай следующий раунд"
          : "Поставить " + money(bet) + " CR";

  $("actionButton").disabled =
    busy ||
    (phase === "waiting" && activeBet > 0) ||
    (phase === "flying" && (activeBet === 0 || cashedOut)) ||
    phase === "crashed";

  $("playerBet").textContent = activeBet
    ? "Ставка " + money(activeBet) + " CR"
    : "Ожидает ставку";

  $("playerResult").textContent = cashedOut
    ? "Забрано"
    : activeBet && phase === "flying"
      ? "В игре"
      : "—";

  $("historyList").innerHTML = history.slice(0, 5).map(value =>
    `<span class="history-item ${value >= 2 ? "good" : "bad"}">${Number(value).toFixed(2)}x</span>`
  ).join("") || '<span class="history-item">—</span>';

  $("playerName").textContent =
    tg?.initDataUnsafe?.user?.first_name || "Ты";

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
    showMessage("Не удалось получить состояние игры: " + error.message);
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
      showMessage("Ставка принята сервером.");
    } else if (phase === "flying" && activeBet > 0 && !cashedOut) {
      const data = await api("/api/cashout", {
        method: "POST",
        body: JSON.stringify({ user_id: userId })
      });

      balance = data.balance;
      cashedOut = true;
      showMessage(
        "Забрано " + money(data.payout) +
        " CR при " + data.multiplier.toFixed(2) + "x"
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
          ? "История раундов отображается над ставкой."
          : button.dataset.tab === "top"
            ? "Таблица лидеров добавим следующим этапом."
            : "Профиль добавим следующим этапом."
      );
    } else {
      showMessage("Баланс и ставки — только виртуальные CR.");
    }
  });
});

refreshState();
setInterval(refreshState, 200);
