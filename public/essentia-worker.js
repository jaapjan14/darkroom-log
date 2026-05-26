// Pure-JS beat detection worker — thorough variant.
//
// Improvements over the simple version:
//   • Hop size 256 (2× temporal resolution).
//   • Multi-band onset: broadband RMS-delta + low-band (≤200 Hz) RMS-delta
//     where the low-band catches kick drums even when buried in the mix.
//     Combined onset = broadband + 2×lowband, then smoothed.
//   • Autocorrelation of onset strength with parabolic peak interpolation
//     for fractional-BPM precision.
//   • Progress messages back to main thread so the UI can show real status.

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type !== 'analyze') return;
  const { file, samples } = msg;
  try {
    const post = (stage, message) =>
      self.postMessage({ type: 'progress', file, stage, message });
    const result = detectBeats(samples, 44100, post);
    self.postMessage({ type: 'done', file, ...result });
  } catch (err) {
    self.postMessage({ type: 'error', file, stage: 'analyze', error: String(err && err.message || err) });
  }
};

// One-pole low-pass filter (in place would be marginally faster but we need
// the original samples elsewhere)
function lowPass(samples, cutoffHz, sr) {
  const dt = 1 / sr;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  const out = new Float32Array(samples.length);
  let acc = 0;
  for (let i = 0; i < samples.length; i++) {
    acc = acc + alpha * (samples[i] - acc);
    out[i] = acc;
  }
  return out;
}

function frameRMS(samples, frameSize, hopSize) {
  const numFrames = Math.max(0, Math.floor((samples.length - frameSize) / hopSize));
  const out = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * hopSize;
    for (let i = 0; i < frameSize; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    out[f] = Math.sqrt(sum / frameSize);
  }
  return out;
}

function detectBeats(samples, sampleRate, post) {
  const frameSize = 1024;
  const hopSize = 256;                         // 2× resolution vs simple version
  const frameRate = sampleRate / hopSize;      // frames per second
  const len = samples.length;
  if (len < frameSize * 8) throw new Error('audio too short');

  // 1. Build the low-band signal — two cascaded low-passes at 200 Hz for
  // steeper rolloff so we catch kicks but not bass-line midrange.
  post('filter', 'low-band filter');
  let lowBand = lowPass(samples, 200, sampleRate);
  lowBand = lowPass(lowBand, 200, sampleRate);

  // 2. RMS envelopes for both bands
  post('envelope', 'envelope (broadband)');
  const rmsBroad = frameRMS(samples, frameSize, hopSize);
  post('envelope', 'envelope (low-band)');
  const rmsLow = frameRMS(lowBand, frameSize, hopSize);
  const numFrames = rmsBroad.length;

  // 3. Positive RMS delta = onset strength, per band
  const onsetBroad = new Float32Array(numFrames);
  const onsetLow = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    const db = rmsBroad[f] - rmsBroad[f - 1];
    onsetBroad[f] = db > 0 ? db : 0;
    const dl = rmsLow[f] - rmsLow[f - 1];
    onsetLow[f] = dl > 0 ? dl : 0;
  }
  // Normalize each band by its peak so we can combine fairly
  let broadMax = 1e-9, lowMax = 1e-9;
  for (let f = 0; f < numFrames; f++) {
    if (onsetBroad[f] > broadMax) broadMax = onsetBroad[f];
    if (onsetLow[f] > lowMax) lowMax = onsetLow[f];
  }
  // 4. Combine: broadband 1× + low-band 2× (kicks weighted higher)
  const onset = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    onset[f] = onsetBroad[f] / broadMax + 2 * (onsetLow[f] / lowMax);
  }
  // Light smoothing
  const smooth = new Float32Array(numFrames);
  for (let f = 2; f < numFrames - 2; f++) {
    smooth[f] = (onset[f - 2] + 2 * onset[f - 1] + 3 * onset[f] + 2 * onset[f + 1] + onset[f + 2]) / 9;
  }

  let totalEnergy = 0;
  for (let f = 0; f < numFrames; f++) totalEnergy += smooth[f];
  if (totalEnergy < 1e-6) throw new Error('no onset content');

  // 5. Tempo via autocorrelation of onset strength
  post('tempo', 'autocorrelation');
  const minBpm = 60, maxBpm = 180;
  const minLag = Math.max(2, Math.floor(60 / maxBpm * frameRate));
  const maxLag = Math.ceil(60 / minBpm * frameRate);
  const acf = new Float32Array(maxLag - minLag + 1);
  let bestLag = minLag, bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const overlap = numFrames - lag;
    for (let f = 0; f < overlap; f++) sum += smooth[f] * smooth[f + lag];
    const score = sum / overlap;
    acf[lag - minLag] = score;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  // 6. Parabolic peak interpolation around the integer ACF peak — gives us
  // fractional-lag precision so detected BPM isn't quantized to integers.
  let refinedLag = bestLag;
  const idx = bestLag - minLag;
  if (idx > 0 && idx < acf.length - 1) {
    const a = acf[idx - 1], b = acf[idx], c = acf[idx + 1];
    const denom = (a - 2 * b + c);
    if (Math.abs(denom) > 1e-9) {
      const offset = 0.5 * (a - c) / denom;
      refinedLag = bestLag + offset;
    }
  }
  const bpm = 60 * frameRate / refinedLag;
  const beatSec = 60 / bpm;

  // 7. Phase: try each integer phase in [0, beatPeriodFrames), score by
  // summed onset energy on the implied beat grid.
  post('phase', 'phase alignment');
  const beatPeriodFrames = refinedLag;
  let bestPhaseFrames = 0, bestPhaseScore = -1;
  const phaseEnd = Math.floor(beatPeriodFrames);
  for (let p = 0; p < phaseEnd; p++) {
    let sum = 0;
    for (let f = p; f < numFrames; f += beatPeriodFrames) {
      const fInt = Math.round(f);
      if (fInt < numFrames) sum += smooth[fInt];
    }
    if (sum > bestPhaseScore) { bestPhaseScore = sum; bestPhaseFrames = p; }
  }
  // Sub-frame phase refinement
  let refinedPhase = bestPhaseFrames;
  if (bestPhaseFrames > 0 && bestPhaseFrames < phaseEnd - 1) {
    const pa = scorePhase(smooth, bestPhaseFrames - 1, beatPeriodFrames);
    const pb = bestPhaseScore;
    const pc = scorePhase(smooth, bestPhaseFrames + 1, beatPeriodFrames);
    const denom = (pa - 2 * pb + pc);
    if (Math.abs(denom) > 1e-9) refinedPhase = bestPhaseFrames + 0.5 * (pa - pc) / denom;
  }
  const phaseSec = refinedPhase / frameRate;

  // 8. Beat grid
  const songSec = len / sampleRate;
  const beats = [];
  for (let t = phaseSec; t < songSec; t += beatSec) beats.push(t);

  // Confidence: ACF peak / mean ACF score
  let acfMean = 0;
  for (let i = 0; i < acf.length; i++) acfMean += acf[i];
  acfMean /= acf.length;
  const confidence = acfMean > 0 ? bestScore / acfMean : 0;

  post('done', 'finished');
  return { bpm, beats, confidence };
}

function scorePhase(onset, p, period) {
  let sum = 0;
  for (let f = p; f < onset.length; f += period) {
    const fInt = Math.round(f);
    if (fInt < onset.length) sum += onset[fInt];
  }
  return sum;
}
