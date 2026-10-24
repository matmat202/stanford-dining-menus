/* allergen-check.js — "the ingredients name an allergen R&DE didn't tag"
 *
 * The exclusion filter trusts R&DE's allergen tags (dish.a). The ingredient text (dish.i)
 * sometimes disagrees: on 2026-10-21, Jackfruit Carnitas listed soy sauce with no SOY or
 * WHEAT tag, and Elote listed mayonnaise with no EGG tag. Measured on 341 dishes, then out
 * of sample on 117 that had rotated off the menu (projects/allergen-xcheck/NOTES.md),
 * about 1-2% of dishes are real misses.
 *
 * Precision was only ~20-30%. "Vegetarian oyster sauce", egg substitutes and GF flours
 * all read as allergens, and those dishes sit at the allergy-friendly stations. So this
 * must never HIDE a dish. It returns the phrase it matched, and the page quotes it and
 * leaves the judgement to the reader.
 *
 * A dish with no ingredients and no tags at all (Burger Bar, Nacho Bar) used to pass every
 * exclusion. noData() is how the page marks those instead.
 */
(function (root) {
  // Phrases that name a substitute, not the allergen. Stripped before matching any allergen.
  const NEG_ALL = [
    /\b(allergen|dairy|egg|gluten|soy|nut)[- ]free\b(\s+[\w"]+){0,2}/g,
    /\bnon[- ]?(allergen|dairy)\b(\s+\w+){0,3}/g,
    /\b(plant[- ]based|plant[- ]powered|vegan|vegetarian)\s+["\w]+(\s+(sauce|cheese|milk|butter|mayo))?/g,
    /["\w]+"?\s+substitute\b/g, /\balternative\s+\w+/g, /\bprime roots tofu\b/g,
    /\bjust egg\b/g, /\baquafaba mayo\b/g, /\bdaiya(\s+\w+){1,3}/g, /\bsoyrizo\b/g,
    /\b(gf|gluten[- ]free)(\s+\w+){1,2}/g, /\bimitation crab\b/g,
  ];
  const RULES = {
    MILK: { pos: /\b(milk|butter|cheese|cream|yogurt|whey|parmesan|mozzarella|cheddar|ricotta|feta|ghee|casein|buttermilk|half and half)\b/,
            neg: [/\b(oat|almond|soy|rice|coconut|cashew)\s+(milk|cream|yogurt|cheese)\b/g,
                  /\b(peanut|cocoa|apple|sunflower|nut|almond|seed)\s+butter\b/g,
                  /\bbutter lettuce\b/g, /\bbutternut\b/g, /\bcream of tartar\b/g, /\bcream soda\b/g] },
    EGG: { pos: /\b(eggs?|egg yolks?|mayonnaise|mayo|aioli)\b/,
           neg: [/\beggplant\b/g] },
    WHEAT: { pos: /\b(wheat|flour|bread|breadcrumbs|panko|pasta|couscous|farro|semolina|soy sauce|seitan|tortillas?|buns?|pretzels?)\b/,
             neg: [/\b(garbanzo|chickpea|rice|corn|cassava|almond|coconut|mustard|oat|soy|tapioca|sorghum|potato|millet|quinoa|teff|bean|starch)\s+flour\b/g,
                   /\bcorn tortillas?\b/g, /\bbuckwheat\b/g] },
    SOY: { pos: /\b(soy sauce|soy|soybeans?|tofu|edamame|tamari|miso)\b/,
           neg: [/\bsoybean oil\b/g] },
    SESAME: { pos: /\b(sesame|tahini)\b/, neg: [] },
    PEANUTS: { pos: /\bpeanuts?\b/, neg: [] },
    FISH: { pos: /\b(salmon|tuna|cod|tilapia|anchov\w*|fish sauce|pollock|halibut|swai|sardines?)\b/, neg: [] },
    SHELLFISH: { pos: /\b(shrimp|crab|lobster|scallops?|clams?|mussels?|oysters?)\b/,
                 neg: [/\b(oyster|king oyster)\s+mushrooms?\b/g] },
    TREENUTS: { pos: /\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamia)\b/,
                neg: [/\balmond (milk|butter|flour)\b/g] },
    COCONUT: { pos: /\bcoconut\b/, neg: [] },
  };

  const tagSet = (a) => new Set((a || '').split(/[,;]/).map(s => s.trim().toUpperCase()).filter(Boolean));

  /** [{allergen, phrase}] for each allergen the ingredients name but the tags don't. */
  function untagged(dish) {
    const ing = (dish.i || '').toLowerCase();
    if (!ing) return [];
    if (/free from the top (food )?allergens/.test(ing)) return [];
    const tags = tagSet(dish.a);
    let base = ing;
    for (const re of NEG_ALL) base = base.replace(re, ' ');
    const out = [];
    for (const [allergen, r] of Object.entries(RULES)) {
      if (tags.has(allergen)) continue;
      let text = base;
      for (const re of r.neg) text = text.replace(re, ' ');
      const m = text.match(r.pos);
      if (m) out.push({ allergen, phrase: m[0] });
    }
    return out;
  }

  /** R&DE published nothing for this dish: no ingredients, no tags, no shared equipment. */
  const noData = (dish) => !dish.i && !dish.a && !dish.x;

  /** What the exclusion filter should warn about for this dish, given the excluded set. */
  function warnFor(dish, excluded) {
    if (!excluded || !excluded.size) return { noData: false, hits: [] };
    return { noData: noData(dish), hits: untagged(dish).filter(h => excluded.has(h.allergen)) };
  }

  /* Diet tags vs R&DE's OWN allergen tags. Both fields come from the same source, so a
   * contradiction here is near-certain, unlike untagged()'s ingredient matching. Measured on
   * 361 dish records (2026-10-21..29, projects/diet-tag-check/NOTES.md): Plant-Forward
   * Picadillo Burrito is tagged vegan AND allergen EGG ("crumbles ... contains egg"). Ingredient
   * words are only used for what no allergen tag covers (honey, gelatin): matching "milk" or
   * "beef" in the text hit ~30 dishes, nearly all oat milk and plant-forward "beef". */
  const DIET_RULES = {
    vg: { label: 'vegan', allergens: ['EGG', 'MILK', 'FISH', 'SHELLFISH'], words: /\b(honey|gelatin)\b/ },
    v: { label: 'vegetarian', allergens: ['FISH', 'SHELLFISH'], words: /\bgelatin\b/ },
    gf: { label: 'gluten-free', allergens: ['WHEAT'], words: null },
  };
  const DIET_NEG = [/\b(vegan|plant[- ]based|bee[- ]free)\s+(honey|gelatin)\b/g, /\bhoney[- ]?free\b/g,
                    /\bhoney(dew|crisp)\b/g, /\bagar\b/g];

  /** [{tag, label, why, from}] for each diet tag the dish's own allergen tags or ingredients contradict. */
  function dietConflicts(dish) {
    const out = [], tags = tagSet(dish.a);
    let ing = (dish.i || '').toLowerCase();
    for (const re of DIET_NEG) ing = ing.replace(re, ' ');
    for (const t of dish.t || []) {
      const r = DIET_RULES[t];
      if (!r) continue;
      for (const a of r.allergens) if (tags.has(a)) out.push({ tag: t, label: r.label, why: a.toLowerCase(), from: 'allergens' });
      const m = r.words && ing.match(r.words);
      if (m) out.push({ tag: t, label: r.label, why: m[0], from: 'ingredients' });
    }
    return out;
  }

  /* Pork, and R&DE's own "not halal" note. R&DE stopped publishing halal on 2026-10-20 (the
   * Halal chip had ~250 dish rows a week), so halal-observing diners have nothing to go on.
   * The ingredient text still says "(non-halal)" on most pork, but not all: hand-labelled
   * over the 10-23 week (projects/pork-marker/NOTES.md), R&DE marked 18 of ~29 pork dishes,
   * and marked 2 chicken sausages for their sheep casing. So these are two claims. "pork" is
   * read from the words. "not halal" quotes R&DE where no pork word is found. Gelatin and
   * stock name no animal, so they claim nothing. Marks only, never hides. */
  const PORK = /\b(pork|bacon|ham|hams|pepperoni|chorizo|carnitas|prosciutto|pancetta|salami|lard|andouille|guanciale|chicharr[oó]n(es)?|cerdo|kielbasa|mortadella|capicola|soppressata)\b/;
  const PORK_NEG = [/\b(turkey|beef|chicken|veggie|vegan|plant[- ]based|soy|tofu|jackfruit|mushroom)\s+(bacon|ham|pepperoni|chorizo|carnitas|salami)\b/g,
                    /\bsoyrizo\b/g, /\bhamburger\b/g];
  const NOT_HALAL = /\(?\b(non[- ]?halal|not halal)\b\)?/;

  /** {kind:'pork'|'not-halal', phrase} or null. A vegan or vegetarian tag rules out pork
   * words (Jackfruit Carnitas), not R&DE's note: it marks wine in a vegetarian sauce too. */
  function porkNote(dish) {
    const t = dish.t || [];
    let text = ((dish.n || '') + ' ; ' + (dish.i || '')).toLowerCase();
    for (const re of PORK_NEG) text = text.replace(re, ' ');
    const m = !(t.includes('vg') || t.includes('v')) && text.match(PORK);
    if (m) return { kind: 'pork', phrase: m[0] };
    const h = text.match(NOT_HALAL);
    if (h) return { kind: 'not-halal', phrase: h[0].replace(/[()]/g, '') };
    return null;
  }

  const api = { untagged, noData, warnFor, dietConflicts, porkNote, RULES, DIET_RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AllergenCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
