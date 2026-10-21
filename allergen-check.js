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

  const api = { untagged, noData, warnFor, RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AllergenCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
