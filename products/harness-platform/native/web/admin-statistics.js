(() => {
  const form = document.querySelector('#stats-batch');
  const all = form.querySelector('[data-stats-select-all]');
  const rows = [...form.querySelectorAll('input[name="account"]')];
  const submit = form.querySelector('button[type="submit"]');
  const count = form.querySelector('output');

  function update() {
    const selected = rows.filter(row => row.checked).length;
    all.disabled = rows.length === 0;
    all.checked = rows.length > 0 && selected === rows.length;
    all.indeterminate = selected > 0 && selected < rows.length;
    submit.disabled = selected === 0;
    count.textContent = selected ? 'Выбрано: ' + selected : '';
  }

  all.addEventListener('change', () => {
    rows.forEach(row => { row.checked = all.checked; });
    update();
  });
  rows.forEach(row => row.addEventListener('change', update));
  window.addEventListener('pageshow', update);
  update();
})();
