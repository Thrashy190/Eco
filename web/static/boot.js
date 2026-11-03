// Runs before the page is drawn: replays the last theme so there is no flash of the wrong colours.
// (A plain script on purpose: modules load too late for this.)
(function () {
  try {
    var boot = JSON.parse(localStorage.getItem("eco.boot"));
    if (!boot) return;
    var root = document.documentElement;
    for (var name in boot.attrs) if (boot.attrs[name]) root.dataset[name] = boot.attrs[name];
    for (var variable in boot.vars) root.style.setProperty(variable, boot.vars[variable]);
    if (boot.background) root.style.backgroundColor = boot.background;
  } catch (e) { /* storage unavailable: defaults apply */ }
})();
