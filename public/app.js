
function formatCountdown(target) {
  if (!target) return "—";
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return "00:00:00";
  const sec = Math.floor(diff / 1000);
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
function updateCountdowns() {
  document.querySelectorAll(".countdown").forEach(el => {
    el.textContent = formatCountdown(el.dataset.target);
  });
}
updateCountdowns();
setInterval(updateCountdowns, 1000);
