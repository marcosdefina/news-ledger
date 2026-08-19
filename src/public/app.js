document.querySelectorAll("[data-source-image]").forEach((image) => {
  image.addEventListener("error", () => {
    image.closest("figure, .ledger-row__image")?.classList.add("has-image-error");
    image.remove();
  });
});