(function () {
    "use strict";

    const originalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {
        let requestUrl = url;

        if (typeof requestUrl === "string" && requestUrl.includes("/admin/autocomplete/")) {
            const parsedUrl = new URL(requestUrl, window.location.origin);
            if (["manager", "user"].includes(parsedUrl.searchParams.get("field_name"))) {
                const companyField = document.getElementById("id_company");
                parsedUrl.searchParams.set("company_id", companyField ? companyField.value : "");
                requestUrl = parsedUrl.pathname + parsedUrl.search;
            }
        }

        const args = Array.prototype.slice.call(arguments);
        args[1] = requestUrl;
        return originalOpen.apply(this, args);
    };

    document.addEventListener("DOMContentLoaded", function () {
        const companyField = document.getElementById("id_company");
        const linkedField = document.getElementById("id_manager") || document.getElementById("id_user");

        if (!companyField || !linkedField) {
            return;
        }

        companyField.addEventListener("change", function () {
            linkedField.value = "";
            linkedField.dispatchEvent(new Event("change", {bubbles: true}));
        });
    });
})();
