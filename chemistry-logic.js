/* chemistry-logic.js — "what's happening in the pan"
 *
 * A dish's name often says how it was cooked: seared, braised, caramelized, pickled.
 * Each of those words is a piece of chemistry, and the open dish shows it as one or
 * two short notes. Nothing is asked of the reader; it is there for whoever taps.
 *
 * Read from the NAME only. R&DE's ingredient lists say what went in, not what the
 * heat did. Measured over the archive (projects/menu-chemistry/BRIEF.md): 23% of
 * 861 unique dish names carry one of these words, median 4 dishes a meal, and 2 of
 * 539 hall-meals have none.
 *
 * Words match whole (\b): "char" must not hit chard or charcuterie. RULES run in
 * order and a dish gets at most MAX notes, so the specific rule (buttermilk,
 * hard-boiled, caramelized) goes before the general one it would also match.
 */
(function (root) {
  const MAX = 2;

  const RULES = [
    { id: 'caramel', re: /\bcaramel(?:i[sz]ed)?\b|\bbr[uû]l[ée]e\b/,
      note: 'Caramelization: sugar on its own breaking apart into hundreds of new compounds, ' +
        'from about 160 °C (320 °F) for table sugar and 110 °C for fructose. Caramelized ' +
        'onions owe much of their colour to the Maillard reaction too, since onions carry ' +
        'amino acids as well as sugar.' },
    { id: 'hardboil', re: /\bhard[- ]boiled\b/,
      note: 'The egg white sets from about 62 °C and the yolk from about 65 °C. The grey-green ' +
        'ring on an overcooked yolk is iron sulfide: sulfur released from the white meeting ' +
        'iron in the yolk.' },
    { id: 'buttermilk', re: /\bbuttermilk\b/,
      note: 'Baking soda (a base) meets the lactic acid in buttermilk and gives off carbon ' +
        'dioxide. Those are the bubbles that rise through the batter before it is flipped.' },
    { id: 'ceviche', re: /\bceviche\b|\baguachile\b/,
      note: 'Lime juice cooks without heat: its acid unfolds the fish proteins much as heat ' +
        'would, so the flesh turns opaque and firm. Unlike heat, it does not reliably kill bacteria.' },
    { id: 'char', re: /\bcharred\b|\bblackened\b|\bburnt\b/,
      note: 'Past about 180 °C, browning gives way to pyrolysis. Sugars and proteins break down ' +
        'into carbon, and that black edge is where the bitterness comes from.' },
    { id: 'maillard', re: /\b(?:pan[- ])?seared\b|\bgrilled\b|\broast(?:ed)?\b|\btoasted\b|\bbrowned\b|\bsaut[ée]{1,2}d?\b|\bgriddled\b|\bbroiled\b|\bstir[- ]fr(?:y|ied)\b/,
      note: 'The Maillard reaction: amino acids and sugars on a dry surface react quickly from ' +
        'about 140 °C (285 °F), making the browns and the roasty flavour. Water cannot get past ' +
        '100 °C, so the surface has to dry out before it can brown.' },
    { id: 'fried', re: /\b(?:deep[- ])?fried\b|\bcrispy\b|\btempura\b|\bfritters?\b|\bkatsu\b|\btots\b|\bfries\b/,
      note: 'Oil at 175–190 °C turns surface water to steam, and the bubbling is that water ' +
        'escaping. Once the surface is dry it passes 100 °C and browns, while steam still ' +
        'pushing outward keeps most of the oil out of the middle.' },
    { id: 'braise', re: /\bbraised?\b|\bstew(?:ed)?\b|\bsmothered\b|\bslow[- ](?:cooked|roasted)\b|\bpot roast\b|\bpulled\b|\bcarnitas\b|\bbirria\b|\bbarbacoa\b|\bshort ribs?\b|\bosso buco\b/,
      note: 'Collagen, the tough connective tissue, slowly unwinds into gelatin when held at ' +
        'about 70–80 °C for hours. Hotter and faster squeezes the water out of the muscle ' +
        'fibres first, which is why braises are cooked low and slow.' },
    { id: 'egg', re: /\bscrambled?\b|\bpoached\b|\bomelett?e\b|\bfrittata\b|\bquiche\b|\bshakshuka\b/,
      note: 'Egg proteins unfold and link up as they heat: the white starts to set near 62 °C and ' +
        'is firm by 80 °C. Gentle heat keeps the curds soft. High heat tightens them until ' +
        'they squeeze out water and weep.' },
    { id: 'custard', re: /\bcustard\b|\bflan\b|\bpudding\b|\bpanna cotta\b|\bcr[eè]me\b/,
      note: 'Egg proteins set a custard at around 80 °C. Past about 85 °C they bond too tightly ' +
        'and it curdles, which is why custards bake in a water bath that cannot go above 100 °C.' },
    { id: 'steam', re: /\bsteamed\b|\bdumplings?\b|\bbao\b|\btamales?\b/,
      note: 'Steam cannot get hotter than 100 °C at sea level, so steamed food never browns. ' +
        'It still cooks fast: steam condensing on the food gives up a large amount of hidden ' +
        '(latent) heat.' },
    { id: 'smoke', re: /\bsmoked?\b|\bbbq\b|\bbarbecue\b/,
      note: 'Smouldering wood breaks its lignin down into phenols such as guaiacol and syringol. ' +
        'Those phenols are the smell of smoke, and they also slow spoilage, which is why ' +
        'smoking began as a way to preserve food.' },
    { id: 'cure', re: /\bcured\b|\bbacon\b|\bham\b|\bprosciutto\b|\bpastrami\b|\bcorned\b|\bsalami\b|\bpepperoni\b|\bchorizo\b/,
      note: 'Salt pulls water out of the meat, and out of any microbes in it. Nitrite binds ' +
        'myoglobin into a pink that holds up to heat, which is why ham and bacon stay pink ' +
        'once they are cooked.' },
    { id: 'pickle', re: /\bpickled?\b|\bpickles\b|\bescabeche\b|\bgiardiniera\b/,
      note: 'Vinegar’s acetic acid pulls the pH below 4.6, where the bacterium behind ' +
        'botulism cannot grow. The sourness is the preservative.' },
    { id: 'ferment', re: /\bfermented\b|\bkimchi\b|\bsauerkraut\b|\bmiso\b|\byogh?urt\b|\bsourdough\b|\bkombucha\b/,
      note: 'Lactic acid bacteria eat the sugars and leave lactic acid behind. Doing so they ' +
        'sour the food and protect it at the same time, and kimchi’s fizz is their carbon dioxide.' },
    { id: 'whip', re: /\bwhipped\b|\bmousse\b|\bmeringue\b/,
      note: 'Whisking traps air inside a mesh: partly broken fat globules in cream, or unfolded ' +
        'proteins in egg white. Cream only whips cold, because warm fat melts and the mesh collapses.' },
    { id: 'glaze', re: /\bglazed?\b|\bcandied\b|\bteriyaki\b|\bhoney[- ]garlic\b/,
      note: 'A glaze is sugar boiled down. As the water leaves, the syrup can climb above 100 °C, ' +
        'and that is where it goes glossy and starts to caramelize.' },
    { id: 'confit', re: /\bconfit\b/,
      note: 'Cooked slowly under fat at around 80–90 °C, far below frying. Fat does not ' +
        'evaporate the way water does, so the meat cannot dry out.' },
    { id: 'leaven', re: /\bpancakes?\b|\bwaffles?\b|\bbiscuits?\b|\bmuffins?\b|\bscones?\b|\bcornbread\b|\bbaked\b/,
      note: 'Leavening gas (carbon dioxide from baking powder or yeast) expands as the batter ' +
        'heats, and from about 60 °C the starch swells and gelatinizes, fixing the bubbles in ' +
        'place. The outside dries and browns by the Maillard reaction.' },
  ];

  /** Lower-case and fold the accents R&DE is inconsistent about ("Sautéed" / "Sauteed" both match). */
  function fold(s) { return String(s || '').toLowerCase(); }

  /** Up to MAX {id, note} for a dish name, in RULES order; [] when its name says nothing. */
  function notesFor(name) {
    const n = fold(name), out = [];
    for (const r of RULES) {
      if (out.length >= MAX) break;
      if (r.re.test(n)) out.push({ id: r.id, note: r.note });
    }
    // Caramelized already explains its own Maillard share; a second browning note repeats it.
    if (out.length === 2 && out[0].id === 'caramel' && out[1].id === 'maillard') out.pop();
    return out;
  }

  const api = { notesFor, RULES, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChemistryLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
