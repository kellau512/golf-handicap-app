const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateTeeResult,
  scorecardForTee,
  strokesForHole,
  summarizeStrokes
} = require("../public/calculator");

const tee = {
  rating: 72.4,
  slope: 128,
  holes: Array.from({ length: 18 }, (_, index) => ({
    number: index + 1,
    par: index === 4 || index === 11 ? 3 : index === 8 || index === 17 ? 5 : 4,
    handicap: index + 1
  }))
};

test("calculates course handicap and target score from rating, slope, par, and Handicap Index", () => {
  const result = calculateTeeResult(tee, 12.4);

  assert.equal(result.totalPar, 72);
  assert.equal(result.courseHandicap, 14);
  assert.equal(result.targetScore, 86);
});

test("allocates positive strokes by hole handicap rank", () => {
  assert.equal(strokesForHole(20, 1), 2);
  assert.equal(strokesForHole(20, 2), 2);
  assert.equal(strokesForHole(20, 3), 1);
  assert.equal(strokesForHole(20, 18), 1);
});

test("allocates plus handicaps as strokes given back", () => {
  assert.equal(strokesForHole(-3, 1), -1);
  assert.equal(strokesForHole(-3, 3), -1);
  assert.equal(strokesForHole(-3, 4), 0);
});

test("builds per-hole and total scorecard targets", () => {
  const scorecard = scorecardForTee(tee, 15);

  assert.equal(scorecard.holes[0].target, 5);
  assert.equal(scorecard.holes[15].target, 4);
  assert.equal(scorecard.holes[17].target, 5);
  assert.equal(scorecard.total.par, 72);
  assert.equal(scorecard.total.strokes, 15);
  assert.equal(scorecard.total.target, 87);
});

test("summarizes stroke allocation in golfer-facing language", () => {
  assert.equal(summarizeStrokes(0), "No extra strokes allocated.");
  assert.equal(summarizeStrokes(5), "Receive 1 stroke on holes ranked 1-5.");
  assert.equal(summarizeStrokes(20), "Receive 1 stroke on every hole, plus 1 more on holes ranked 1-2.");
  assert.equal(summarizeStrokes(-2), "Give back 1 stroke on holes ranked 1-2.");
});
