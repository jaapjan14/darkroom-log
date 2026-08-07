// Deterministic templating engine implementing ~/Desktop/tag-generation-spec.md.
// Everything here is pure string/array logic — no network calls. The one
// non-deterministic input is `rankedTags`, an array of tag strings already
// ordered by search value (AI-ranked upstream in server.js, falling back to
// the print's own tags[] order when ranking is unavailable).

const { cameraInfo, lensSlug, lensShort, filmInfo, stripPushPull, genericSlug } = require('./gear-catalog');

const PNW_STATES = new Set(['Washington', 'Oregon']);
const LOMOGRAPHY_CHAR_LIMIT = 123;
const FLICKR_TAG_CAP = 28;

// description follows "Camera | Film | Developer | Lens" (segment 1 is
// reliably the film across all format variants — see server.js film parsing
// and darkroom-film-type-filter-project memory).
function parseDescription(description) {
  const parts = (description || '').split('|').map(s => s.trim());
  return {
    camera: parts[0] || '',
    film: parts[1] || '',
    developer: parts[2] || '',
    lens: parts[3] || '',
  };
}

// "Xtol 1:1 + Rodinal 1:400" -> "Xtol + Rodinal" (compound: drop dilutions)
// "Rodinal 1:50" -> "Rodinal 1:50" (single developer: keep its dilution)
function compactDeveloperPlus(developer) {
  const parts = (developer || '').split('+').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return developer || '';
  return parts.map(p => p.replace(/\s*\d+:\d+\s*/g, '').trim()).join(' + ');
}

// Flickr tag form: same as compactDeveloperPlus but space-joined, no "+".
function compactDeveloperFlickr(developer) {
  return compactDeveloperPlus(developer).replace(/\s*\+\s*/g, ' ');
}

function standardCaption({ title, description }) {
  const { camera, film, developer, lens } = parseDescription(description);
  return `${title} / ${camera} | ${film} | ${developer} | ${lens}`.trim();
}

function lomographyTags(rankedTags) {
  let out = [];
  let len = 0;
  for (const tag of rankedTags) {
    const t = tag.trim();
    if (!t) continue;
    const addLen = (out.length ? 2 : 0) + t.length; // ", " separator
    if (len + addLen > LOMOGRAPHY_CHAR_LIMIT) break;
    out.push(t);
    len += addLen;
  }
  return out.join(', ');
}

function flickrTags({ description, rankedTags, state }) {
  const { camera, film, developer, lens } = parseDescription(description);
  const cam = cameraInfo(camera);
  const film_ = filmInfo(film);

  const fixed = [film, camera, lens, lensShort(lens), compactDeveloperFlickr(developer)]
    .map(s => s.trim())
    .filter(Boolean);

  fixed.push(film_.isColor ? 'color film' : 'black and white film');
  if (cam.format === 'medium format') {
    fixed.push('medium format', '120 film');
    if (cam.negFormat) fixed.push(cam.negFormat);
  } else if (cam.format === '35mm') {
    fixed.push('35mm film');
  }
  fixed.push('analog photography', 'film photography');

  const dynamic = rankedTags.map(t => t.trim()).filter(Boolean);
  if (state && PNW_STATES.has(state)) dynamic.push('Pacific Northwest');

  const combined = [...fixed, ...dynamic];
  // Dedupe (case-insensitive) while preserving first occurrence / fixed-tag priority.
  const seen = new Set();
  const deduped = combined.filter(t => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Cap by dropping lowest-priority (tail) entries first; fixed tags are all
  // near the front so they're preserved unless the cap is absurdly low.
  return deduped.slice(0, FLICKR_TAG_CAP);
}

function filmDisplayName(film) {
  return filmInfo(film).short;
}

// Picks the tag to use for Instagram's 5th (subject/location) slot: prefer a
// ranked tag matching a known city name, else the top-ranked tag not already
// implied by gear hashtags.
function pickInstagramLocationTag(rankedTags, knownCities) {
  const cityNames = new Set((knownCities || []).map(c => c.toLowerCase()));
  const found = rankedTags.find(t => cityNames.has(t.trim().toLowerCase()));
  if (found) return found.trim();
  return (rankedTags[0] || '').trim();
}

function instagramPost({ title, description, rankedTags, knownCities }) {
  const { camera, film, developer, lens } = parseDescription(description);
  const cam = cameraInfo(camera);
  const film_ = filmInfo(film);

  const gearLine = [camera, lens, filmDisplayName(film), compactDeveloperPlus(developer)]
    .filter(Boolean)
    .join(' · ');

  const slot2 = `#${cam.slug}`;
  const slot3 = cam.format === 'medium format' ? '#mediumformat' : `#${lensSlug(lens)}`;
  const slot4 = `#${film_.slug}`;
  const locationTag = pickInstagramLocationTag(rankedTags, knownCities);
  const slot5 = locationTag ? `#${genericSlug(locationTag)}` : '';

  const hashtags = ['#believeinfilm', slot2, slot3, slot4, slot5].filter(Boolean);

  return {
    lines: [title, gearLine, hashtags.join(' ')],
    text: [title, gearLine, hashtags.join(' ')].join('\n'),
  };
}

function generateAll({ title, description, tags, rankedTags, city, state, knownCities }) {
  const ranked = (rankedTags && rankedTags.length ? rankedTags : (tags || [])).slice();
  return {
    standardCaption: standardCaption({ title, description }),
    lomography: lomographyTags(ranked),
    flickr: flickrTags({ description, rankedTags: ranked, state }),
    instagram: instagramPost({ title, description, rankedTags: ranked, knownCities }),
  };
}

module.exports = {
  parseDescription,
  compactDeveloperPlus,
  compactDeveloperFlickr,
  standardCaption,
  lomographyTags,
  flickrTags,
  instagramPost,
  generateAll,
  LOMOGRAPHY_CHAR_LIMIT,
};
