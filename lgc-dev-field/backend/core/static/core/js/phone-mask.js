(function () {
    "use strict";

    function formatInternationalPhone(value) {
        const digits = value.replace(/\D/g, "").slice(0, 13);
        if (!digits) {
            return value.includes("+") ? "+" : "";
        }

        const countryCode = digits.slice(0, 2);
        const areaCode = digits.slice(2, 4);
        const subscriber = digits.slice(4);
        let formatted = `+${countryCode}`;

        if (areaCode) {
            formatted += ` (${areaCode}`;
            if (areaCode.length === 2) {
                formatted += ")";
            }
        }

        if (subscriber) {
            formatted += ` ${subscriber.slice(0, 5)}`;
            if (subscriber.length > 5) {
                formatted += `-${subscriber.slice(5)}`;
            }
        }

        return formatted;
    }

    function applyPhoneMask(input) {
        if (input.dataset.phoneMaskReady === "true") {
            return;
        }

        input.dataset.phoneMaskReady = "true";
        input.inputMode = "tel";
        input.placeholder = "+00 (00) 00000-0000";
        input.maxLength = 20;

        input.addEventListener("input", function () {
            const cursorAtEnd = input.selectionStart === input.value.length;
            input.value = formatInternationalPhone(input.value);
            if (cursorAtEnd) {
                input.setSelectionRange(input.value.length, input.value.length);
            }
        });

        if (input.value) {
            input.value = formatInternationalPhone(input.value);
        }
    }

    function initializePhoneMasks(root) {
        const scope = root instanceof Element ? root : document;
        scope.querySelectorAll('input[name$="phone"]').forEach(applyPhoneMask);
    }

    document.addEventListener("DOMContentLoaded", function () {
        initializePhoneMasks(document);

        new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node instanceof Element) {
                        if (node.matches('input[name$="phone"]')) {
                            applyPhoneMask(node);
                        }
                        initializePhoneMasks(node);
                    }
                });
            });
        }).observe(document.body, {childList: true, subtree: true});
    });
})();
