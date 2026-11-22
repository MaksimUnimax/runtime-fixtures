const filters = document.getElementById("visits-filters");
const period = filters.elements.namedItem("period");
const from = filters.elements.namedItem("date_from");
const to = filters.elements.namedItem("date_to");

period.addEventListener("change", () => {
  const { from: start, to: end } = period.selectedOptions[0].dataset;
  if (start && end) {
    from.value = start;
    to.value = end;
  }
});

for (const date of [from, to]) {
  date.addEventListener("input", () => {
    period.value = "custom";
  });
}
