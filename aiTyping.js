// Shared pacing for AI-filled Facebook editors.
// This file only normalizes timing; feature state, selectors, stop flags and
// success proof remain owned by the individual feature state machines.
const AI_TYPING_PRESETS = Object.freeze({
  fast: Object.freeze({
    minDelayMs: 5, maxDelayMs: 15, chunkSize: 6,
    punctuationPauseMinMs: 0, punctuationPauseMaxMs: 0,
    spacePauseMinMs: 0, spacePauseMaxMs: 5, humanLike: false
  }),
  balanced: Object.freeze({
    minDelayMs: 25, maxDelayMs: 70, chunkSize: 2,
    punctuationPauseMinMs: 60, punctuationPauseMaxMs: 140,
    spacePauseMinMs: 5, spacePauseMaxMs: 20, humanLike: true
  }),
  human: Object.freeze({
    minDelayMs: 45, maxDelayMs: 105, chunkSize: 2,
    punctuationPauseMinMs: 140, punctuationPauseMaxMs: 320,
    spacePauseMinMs: 10, spacePauseMaxMs: 40, humanLike: true
  }),
  custom: Object.freeze({
    minDelayMs: 25, maxDelayMs: 70, chunkSize: 2,
    punctuationPauseMinMs: 60, punctuationPauseMaxMs: 140,
    spacePauseMinMs: 5, spacePauseMaxMs: 20, humanLike: true
  })
});

const AI_TYPING_DEFAULT_MODE = "balanced";

function aiTypingNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function aiTypingClamp(value, min, max, fallback) {
  return Math.min(max, Math.max(min, Math.round(aiTypingNumber(value, fallback))));
}

function normalizeAiTypingConfig(input = {}) {
  const requestedMode = String(input.mode || AI_TYPING_DEFAULT_MODE).toLowerCase();
  const mode = Object.prototype.hasOwnProperty.call(AI_TYPING_PRESETS, requestedMode) ? requestedMode : AI_TYPING_DEFAULT_MODE;
  const preset = AI_TYPING_PRESETS[mode];
  const minDelayMs = aiTypingClamp(input.minDelayMs, 0, 1000, preset.minDelayMs);
  const maxDelayMs = aiTypingClamp(input.maxDelayMs, minDelayMs, 1500, Math.max(minDelayMs, preset.maxDelayMs));
  const punctuationPauseMinMs = aiTypingClamp(input.punctuationPauseMinMs, 0, 1500, preset.punctuationPauseMinMs);
  const punctuationPauseMaxMs = aiTypingClamp(input.punctuationPauseMaxMs, punctuationPauseMinMs, 2000, Math.max(punctuationPauseMinMs, preset.punctuationPauseMaxMs));
  const spacePauseMinMs = aiTypingClamp(input.spacePauseMinMs, 0, 500, preset.spacePauseMinMs);
  const spacePauseMaxMs = aiTypingClamp(input.spacePauseMaxMs, spacePauseMinMs, 700, Math.max(spacePauseMinMs, preset.spacePauseMaxMs));
  return {
    mode,
    minDelayMs,
    maxDelayMs,
    chunkSize: aiTypingClamp(input.chunkSize, 1, 12, preset.chunkSize),
    punctuationPauseMinMs,
    punctuationPauseMaxMs,
    spacePauseMinMs,
    spacePauseMaxMs,
    humanLike: input.humanLike === undefined ? preset.humanLike : input.humanLike !== false
  };
}

function aiTypingRandomInt(min, max) {
  const low = Math.min(Number(min) || 0, Number(max) || 0);
  const high = Math.max(Number(min) || 0, Number(max) || 0);
  return low + Math.floor(Math.random() * (high - low + 1));
}

function aiTypingPauseForChunk(config, chunk) {
  const cfg = normalizeAiTypingConfig(config);
  let pause = 0;
  for (const char of [...String(chunk || "")]) {
    pause += aiTypingRandomInt(cfg.minDelayMs, cfg.maxDelayMs);
    if (cfg.humanLike && /[,.!?;:…。！？]/u.test(char)) {
      pause += aiTypingRandomInt(cfg.punctuationPauseMinMs, cfg.punctuationPauseMaxMs);
    } else if (cfg.humanLike && char === " ") {
      pause += aiTypingRandomInt(cfg.spacePauseMinMs, cfg.spacePauseMaxMs);
    }
  }
  return pause;
}
