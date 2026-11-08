document.addEventListener("DOMContentLoaded", function () {
    const tabs = Array.from(document.querySelectorAll("[data-dashboard-tab]"));
    const panels = Array.from(document.querySelectorAll("[data-dashboard-panel]"));

    function showPanel(name, updateHash) {
        tabs.forEach(function (tab) {
            const active = tab.dataset.dashboardTab === name;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-selected", active ? "true" : "false");
        });
        panels.forEach(function (panel) {
            panel.hidden = panel.dataset.dashboardPanel !== name;
        });
        if (updateHash) {
            history.replaceState(null, "", "#" + name);
        }
    }

    tabs.forEach(function (tab) {
        tab.addEventListener("click", function (event) {
            event.preventDefault();
            showPanel(tab.dataset.dashboardTab, true);
        });
    });

    const initialTab = window.location.hash ? window.location.hash.slice(1) : "";
    const validTab = tabs.some(function (tab) { return tab.dataset.dashboardTab === initialTab; });
    const defaultTab = tabs.length ? tabs[0].dataset.dashboardTab : null;
    showPanel(validTab ? initialTab : defaultTab, false);
});
