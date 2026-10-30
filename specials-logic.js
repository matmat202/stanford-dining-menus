/* specials-logic.js — R&DE's weeknight dinner special for one hall on one day.
 *
 * data/specials.json is written by scrape_specials.py from R&DE's "Dining Hall Specials
 * Calendar" PDF: rows {date:'2026-10-29', hall:'Stern', text:'Dia de Muertos Dinner',
 * event:true}. The menu feed omits most of these (19 of 72 hall-nights carried the named
 * dish, 2026-10-30), so the card says it rather than leaving it to the dish list.
 *
 * Only Dinner: the calendar is "Dinner Specials", and a lunch card showing tonight's
 * special would read as lunch. The lead says R&DE: the calendar and the day's menu feed can
 * disagree (Arrillaga 11-05: calendar sweet-and-sour chicken, feed a poutine night), so
 * the line is attributed, not presented as the menu. The date key comes from local (campus) fields, never
 * toISOString(), which is UTC and would move a 5 pm Pacific lookup to tomorrow.
 */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  /** The row for this hall, day and meal, or null. `data` may be null (file not loaded). */
  function forHall(data, hallId, day, mealName) {
    if (!data || !Array.isArray(data.specials) || mealName !== 'Dinner') return null;
    const key = dateKey(day);
    return data.specials.find(r => r.hall === hallId && r.date === key) || null;
  }

  /** The card's line: a themed dinner is named as one, a weekly special as a special. */
  function label(row) {
    if (!row) return null;
    return row.event ? { kind: 'event', lead: 'Themed dinner', text: row.text }
                     : { kind: 'special', lead: 'R&DE special', text: row.text };
  }

  const api = { dateKey, forHall, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpecialsLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
