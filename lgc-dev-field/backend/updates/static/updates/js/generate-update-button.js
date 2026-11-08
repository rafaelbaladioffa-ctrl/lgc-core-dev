(function () {
    function relabelSaveButton() {
        var isAddPage = /\/updates\/projectdailyupdate\/add\/?(\?.*)?$/.test(window.location.pathname + window.location.search);
        if (!isAddPage) {
            return;
        }
        document.querySelectorAll('input[name="_save"], button[name="_save"]').forEach(function (el) {
            if (el.tagName === "INPUT") {
                el.value = "Gerar Atualização";
            } else {
                el.textContent = "Gerar Atualização";
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", relabelSaveButton);
    } else {
        relabelSaveButton();
    }
})();
