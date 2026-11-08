(function ($) {
    "use strict";

    function initializeBulkDropdowns() {
        $("select.project-bulk-multiselect").each(function () {
            const $select = $(this);

            if (!$select.hasClass("select2-hidden-accessible")) {
                $select.select2({
                    closeOnSelect: false,
                    placeholder: $select.data("placeholder") || "Selecione",
                    theme: "admin-autocomplete",
                    width: "100%",
                });
            }

            const $selection = $select.next(".select2").find(".select2-selection");
            $selection.off("click.projectBulk").on("click.projectBulk", function () {
                $select.select2("open");
            });
        });
    }

    $(initializeBulkDropdowns);
    document.addEventListener("DOMContentLoaded", initializeBulkDropdowns);
})(django.jQuery);
