document.addEventListener("DOMContentLoaded", function () {
    const tabs = Array.from(document.querySelectorAll("[data-project-tab]"));
    const panels = Array.from(document.querySelectorAll("[data-project-panel]"));

    function showPanel(name, updateHash) {
        tabs.forEach(function (tab) {
            const active = tab.dataset.projectTab === name;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-selected", active ? "true" : "false");
        });

        panels.forEach(function (panel) {
            panel.hidden = panel.dataset.projectPanel !== name;
        });

        if (updateHash) {
            history.replaceState(null, "", "#" + name);
        }
    }

    tabs.forEach(function (tab) {
        tab.addEventListener("click", function (event) {
            event.preventDefault();
            showPanel(tab.dataset.projectTab, true);
        });
    });

    const initialTab = window.location.hash ? window.location.hash.slice(1) : "";
    const validTab = tabs.some(function (tab) { return tab.dataset.projectTab === initialTab; });
    showPanel(validTab ? initialTab : "visao-geral", false);

    const subTabs = Array.from(document.querySelectorAll("[data-task-subtab]"));
    const subPanels = Array.from(document.querySelectorAll("[data-task-subpanel]"));

    function showSubPanel(name) {
        subTabs.forEach(function (tab) {
            const active = tab.dataset.taskSubtab === name;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-selected", active ? "true" : "false");
        });
        subPanels.forEach(function (panel) {
            panel.hidden = panel.dataset.taskSubpanel !== name;
        });
    }

    subTabs.forEach(function (tab) {
        tab.addEventListener("click", function (event) {
            event.preventDefault();
            showSubPanel(tab.dataset.taskSubtab);
        });
    });
});
