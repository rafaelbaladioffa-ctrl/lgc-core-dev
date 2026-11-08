(function () {
    "use strict";

    const CLIENT_SCOPED_FIELDS = ["responsible_client", "site"];

    const originalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {
        let requestUrl = url;
        if (typeof requestUrl === "string" && requestUrl.includes("/admin/autocomplete/")) {
            const parsedUrl = new URL(requestUrl, window.location.origin);
            if (CLIENT_SCOPED_FIELDS.includes(parsedUrl.searchParams.get("field_name"))) {
                const clientField = document.getElementById("id_client");
                parsedUrl.searchParams.set("client_id", clientField ? clientField.value : "");
                requestUrl = parsedUrl.pathname + parsedUrl.search;
            }
        }
        const args = Array.prototype.slice.call(arguments);
        args[1] = requestUrl;
        return originalOpen.apply(this, args);
    };

    document.addEventListener("DOMContentLoaded", function () {
        const clientField = document.getElementById("id_client");
        if (!clientField) {
            return;
        }
        clientField.addEventListener("change", function () {
            CLIENT_SCOPED_FIELDS.forEach(function (fieldName) {
                const field = document.getElementById("id_" + fieldName);
                if (field) {
                    field.value = "";
                    field.dispatchEvent(new Event("change", {bubbles: true}));
                }
            });
        });
    });
})();
