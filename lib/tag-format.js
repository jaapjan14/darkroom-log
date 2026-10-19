// Deterministic templating engine implementing ~/Desktop/tag-generation-spec.md.
// Everything here is pure string/array logic — no network calls. The one
// non-deterministic input is `rankedTags`, an array of tag strings already
// ordered by search value (AI-ranked upstream in server.js, falling back to
// the print's own tags[] order when ranking is unavailable).

const { cameraInfo, digitalCameraInfo, lensSlug, lensShort, filmInfo, stripPushPull, genericSlug } = require('./gear-catalog');

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

// Lightroom keywords that only drive Jacob's publishing workflow (which
// photos go to Immich, to the Flickr group) and say nothing about the photo:
// "m11-immich", "z8-immich", "flickr-pool". They're dropped before ranking so
// they never reach a post, and so a photo tagged only with them counts as
// untagged (letting the model's suggestions become its tags).
function isWorkflowTag(tag) {
  const t = (tag || '').trim().toLowerCase();
  return t.endsWith('-immich') || t === 'flickr-pool';
}

// A digital frame has no film-style "Camera | Film | Developer | Lens"
// description but does have a camera model in its EXIF. Returns what the
// templates need for it, or null for a film scan (whose output is unchanged).
// `monochrome` is measured from the image upstream (server.js).
function digitalInfo({ description, model, lens, monochrome }) {
  if ((description || '').includes('|') || !(model || '').trim()) return null;
  const cam = digitalCameraInfo(model);
  return { camera: cam.name, slug: cam.slug, lens: (lens || '').trim(), monochrome: !!monochrome };
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

function standardCaption({ title, description, digital }) {
  if (digital) {
    // "Last Cast / Leica M11 | Thypoch Simera 50mm f/1.4 Asph."
    return `${title} / ${[digital.camera, digital.lens].filter(Boolean).join(' | ')}`.trim();
  }
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

function flickrTags({ description, rankedTags, state, digital }) {
  let fixed;
  if (digital) {
    fixed = [digital.camera, digital.lens, lensShort(digital.lens)].map(s => s.trim()).filter(Boolean);
    if (digital.monochrome) fixed.push('black and white photography');
    fixed.push('digital photography');
  } else {
    const { camera, film, developer, lens } = parseDescription(description);
    const cam = cameraInfo(camera);
    const film_ = filmInfo(film);

    fixed = [film, camera, lens, lensShort(lens), compactDeveloperFlickr(developer)]
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
  }

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

function instagramPost({ title, description, rankedTags, knownCities, digital }) {
  if (digital) {
    // No film to name: gear line is body + lens, and #believeinfilm goes.
    const gearLine = [digital.camera, digital.lens].filter(Boolean).join(' · ');
    const locationTag = pickInstagramLocationTag(rankedTags, knownCities);
    const hashtags = [
      `#${digital.slug}`,
      digital.lens ? `#${lensSlug(digital.lens)}` : '',
      digital.monochrome ? '#blackandwhitephotography' : '',
      locationTag ? `#${genericSlug(locationTag)}` : '',
    ].filter(Boolean);
    return {
      lines: [title, gearLine, hashtags.join(' ')],
      text: [title, gearLine, hashtags.join(' ')].join('\n'),
    };
  }
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

function generateAll({ title, description, tags, rankedTags, city, state, knownCities, digital }) {
  const ranked = (rankedTags && rankedTags.length ? rankedTags : (tags || []))
    .filter(t => !isWorkflowTag(t));
  return {
    standardCaption: standardCaption({ title, description, digital }),
    lomography: lomographyTags(ranked),
    flickr: flickrTags({ description, rankedTags: ranked, state, digital }),
    instagram: instagramPost({ title, description, rankedTags: ranked, knownCities, digital }),
  };
}

module.exports = {
  parseDescription,
  isWorkflowTag,
  digitalInfo,
  compactDeveloperPlus,
  compactDeveloperFlickr,
  standardCaption,
  lomographyTags,
  flickrTags,
  instagramPost,
  generateAll,
  LOMOGRAPHY_CHAR_LIMIT,
};
