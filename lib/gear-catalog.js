// Static lookup tables for Jacob's known camera/lens/film roster (see
// data/filter-cache.json for the live list). Used by lib/tag-format.js to
// resolve format (35mm/medium format) and platform hashtag slugs without a
// model call — new gear not yet in these tables falls back to a generic
// slugifier rather than breaking.

const CAMERA_FORMAT = {
  'Koni-Omega Rapid 100': { format: 'medium format', negFormat: '6x7', slug: 'koniomega' },
  'Konica Hexar RF': { format: '35mm', negFormat: null, slug: 'hexarrf' },
  'Leica M3': { format: '35mm', negFormat: null, slug: 'leicam3' },
  'Leica M6': { format: '35mm', negFormat: null, slug: 'leicam6' },
  'Leica M7': { format: '35mm', negFormat: null, slug: 'leicam7' },
  'Leica MP': { format: '35mm', negFormat: null, slug: 'leicamp' },
  'Mamiya 6 MF': { format: 'medium format', negFormat: '6x6', slug: 'mamiya6' },
  'Mamiya 645 1000s': { format: 'medium format', negFormat: '645', slug: 'mamiya645' },
  'Mamiya 7': { format: 'medium format', negFormat: '6x7', slug: 'mamiya7' },
  'Nikon FE2': { format: '35mm', negFormat: null, slug: 'nikonfe2' },
  'Nikon FM3a': { format: '35mm', negFormat: null, slug: 'nikonfm3a' },
  'Olympus OM-2S Program': { format: '35mm', negFormat: null, slug: 'olympusom2' },
  'Pentax Zoom 90 WR': { format: '35mm', negFormat: null, slug: 'pentaxzoom90' },
};

const LENS_SLUGS = {
  'Koni-Omega Hexanon 90mm f/3.5': 'hexanon90',
  'Konica 58mm f/5.6 Wide Omegon': 'omegon58',
  'Leica Elmar Leitz 9cm f/4': 'elmar90',
  'Leica Summaron 35mm f/2.8': 'summaron35f28',
  'Leica Summaron 35mm f/3.5': 'summaron35f35',
  'Leica Summicron 35mm f/2 v2': 'summicron35',
  'Leica Summicron 50mm f/2 DR': 'summicron50dr',
  'Leica Summicron 50mm f/2 v3': 'summicron50',
  'Leica Summilux 35mm f/1.4 FLE V1': 'summilux35',
  'Leica Summilux 50mm f/1.4 V1': 'summilux50',
  'Leica Summilux-M 50mm f/1.4 ASPH': 'summilux50asph',
  'Leitz Wetzlar Hektor 135mm f/4.5': 'hektor135',
  'Mamiya G 150mm L f/4.5': 'mamiyag150',
  'Mamiya G 50mm L f/4': 'mamiyag50',
  'Mamiya G 75mm L f/3.5': 'mamiyag75',
  'Mamiya N 150mm f/4.5 L': 'mamiyan150',
  'Mamiya N 43mm f/4.5 L': 'mamiyan43',
  'Mamiya N 65mm f/4 L': 'mamiyan65',
  'Mamiya Sekor C 150mm f/3.5': 'sekor150',
  'Mamiya Sekor C 45mm f/2.8': 'sekor45',
  'Mamiya Sekor C 55mm f/2.8': 'sekor55',
  'Mamiya Sekor C 80mm f/2.8': 'sekor80',
  'Mandler 35mm f/2': 'mandler35',
  'Minolta M-Rokkor 40mm f/2': 'mrokkor40',
  'NIKKOR Z MC 105mm f/2.8 VR S': 'nikkorz105',
  'Nikon Nikkor 50mm f/1.4 AIS': 'nikkor50ais',
  'Nikon Nikkor 50mm f/1.8': 'nikkor50',
  'Nikon Zoom-NIKKOR 80-200mm f/4 AI-s': 'nikkor80200',
  'Olympus Zukio 35mm f/2.8': 'zukio35',
  'Olympus Zukio 50mm f/1.8': 'zukio50',
  'Pentax 38-90mm f/3.5 to f/7.8': 'pentax3890',
  'Thypoch Simera 50mm f/1.4 Asph.': 'simera50',
  'Voigtlander APO-Skopar 90mm f/2.8': 'aposkopar90',
  'Voigtlander Color-Skopar 28mm f/2.8': 'colorskopar28',
  'Voigtlander Nokton 58mm f/1.4': 'nokton58',
  'Voigtlander Nokton 75mm f/1.5': 'nokton75',
  'Voigtlander Ultron 28mm f/2': 'ultron28',
  'Voigtlander Ultron 35mm f/2': 'ultron35',
  'Voigtlander Ultron 40mm f/2': 'ultron40',
  'Zeiss C Biogon ZM 35mm f/2.8': 'biogon35',
};

// Keyed by film name with any "@N" pushed/pulled-EI suffix stripped — a
// pushed roll of the same stock shares its base slug and short name.
const FILM_INFO = {
  'ADOX CHS 100 II': { slug: 'chs100', short: 'CHS 100 II' },
  'Black Cat 400': { slug: 'blackcat400', short: 'Black Cat 400' },
  'CineStill BwXX 250': { slug: 'bwxx250', short: 'BwXX 250' },
  'FUJIFILM 400 Color Negative Film': { slug: 'fujifilm400', short: 'Fujifilm 400', isColor: true },
  'Flic Film Ultrafine Xtreme UXF 400': { slug: 'uxf400', short: 'UXF 400' },
  'Fujifilm Fujicolor PRO 400H': { slug: 'pro400h', short: 'Pro 400H', isColor: true },
  'Fujifilm NEOPAN 100 ACROS II': { slug: 'acros100', short: 'Acros 100' },
  'Harman Phoenix II 200': { slug: 'phoenix200', short: 'Phoenix II 200', isColor: true },
  'Ilford Delta 100': { slug: 'delta100', short: 'Delta 100' },
  'Ilford Delta 400': { slug: 'delta400', short: 'Delta 400' },
  'Ilford HP5 Plus 400': { slug: 'hp5plus', short: 'HP5 Plus' },
  'Ilford Ortho Plus 80': { slug: 'orthoplus80', short: 'Ortho Plus 80' },
  'Ilford Pan F Plus 50': { slug: 'panfplus', short: 'Pan F Plus' },
  'Kentmere PAN 100': { slug: 'kentmere100', short: 'Kentmere 100' },
  'Kentmere PAN 200': { slug: 'kentmere200', short: 'Kentmere 200' },
  'Kentmere PAN 400': { slug: 'kentmere400', short: 'Kentmere 400' },
  'KodaColor 200': { slug: 'kodacolor200', short: 'Kodacolor 200', isColor: true },
  'Kodak Gold 200': { slug: 'kodakgold200', short: 'Gold 200', isColor: true },
  'Kodak Portra 400': { slug: 'portra400', short: 'Portra 400', isColor: true },
  'Kodak T-MAX 400': { slug: 'tmax400', short: 'T-Max 400' },
  'Kodak TRI-X 400': { slug: 'trix400', short: 'Tri-X 400' },
  'Kodak Ultramax 400': { slug: 'ultramax400', short: 'Ultramax 400', isColor: true },
  'LomoChrome Turquoise @ 200': { slug: 'lomochrometurquoise', short: 'LomoChrome Turquoise', isColor: true },
  'Lomography Berlin 400': { slug: 'lomographyberlin', short: 'Lomography Berlin 400', isColor: true },
  'ORWO NP100': { slug: 'orwonp100', short: 'ORWO NP100' },
  'Rollei Retro 400': { slug: 'rolleiretro400', short: 'Retro 400' },
  'Rollei Retro 400S': { slug: 'rolleiretro400s', short: 'Retro 400S' },
  'Street Candy ATM 400': { slug: 'streetcandyatm400', short: 'ATM 400' },
  'Ultrafine Xtreme UXF 400': { slug: 'uxf400', short: 'UXF 400' },
};

function stripPushPull(filmName) {
  return (filmName || '').split('@')[0].trim();
}

function genericSlug(name) {
  return (name || '')
    .replace(/f\/[\d.]+/gi, '')          // drop aperture (f/2.8 etc.)
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

function cameraInfo(cameraName) {
  const known = CAMERA_FORMAT[cameraName];
  if (known) return known;
  return { format: 'film', negFormat: null, slug: genericSlug(cameraName) };
}

function lensSlug(lensName) {
  return LENS_SLUGS[lensName] || genericSlug(lensName);
}

function lensShort(lensName) {
  const m = (lensName || '').match(/(\d+(?:-\d+)?)\s*(?:mm|cm)/i);
  if (!m) return lensName || '';
  return /cm/i.test(m[0]) ? `${parseInt(m[1], 10) * 10}mm` : `${m[1]}mm`;
}

function filmInfo(filmName) {
  const base = stripPushPull(filmName);
  const known = FILM_INFO[base];
  if (known) return known;
  return { slug: genericSlug(base), short: base };
}

module.exports = { cameraInfo, lensSlug, lensShort, filmInfo, stripPushPull, genericSlug };
