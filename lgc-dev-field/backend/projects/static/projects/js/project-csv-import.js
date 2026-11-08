document.addEventListener("DOMContentLoaded", function () {
    const input = document.getElementById("id_csv_file");
    const fileName = document.getElementById("project-csv-file-name");

    if (!input || !fileName) {
        return;
    }

    input.addEventListener("change", function () {
        fileName.textContent = input.files && input.files.length
            ? input.files[0].name
            : "Nenhum arquivo selecionado";
    });
});
