(function (global) {
  function strokesForHole(courseHandicap, allocation) {
    const sign = courseHandicap < 0 ? -1 : 1;
    const abs = Math.abs(courseHandicap);
    const base = Math.floor(abs / 18);
    const extra = abs % 18 >= allocation ? 1 : 0;
    const strokes = base + extra;
    return strokes ? sign * strokes : 0;
  }

  function calculateTeeResult(tee, handicapIndex) {
    const totalPar = tee.holes.reduce((sum, hole) => sum + hole.par, 0);
    const slopeAdjustment = handicapIndex * (tee.slope / 113);
    const ratingAdjustment = tee.rating - totalPar;
    const rawCourseHandicap = slopeAdjustment + ratingAdjustment;
    const courseHandicap = Math.round(rawCourseHandicap);
    const rawTargetScore = tee.rating + courseHandicap;
    const targetScore = Math.round(rawTargetScore);

    return {
      totalPar,
      slopeAdjustment,
      ratingAdjustment,
      rawCourseHandicap,
      courseHandicap,
      rawTargetScore,
      targetScore
    };
  }

  function summarizeStrokes(courseHandicap) {
    if (courseHandicap === 0) return "No extra strokes allocated.";
    const abs = Math.abs(courseHandicap);
    const base = Math.floor(abs / 18);
    const extra = abs % 18;
    const direction = courseHandicap > 0 ? "Receive" : "Give back";
    if (!base) return `${direction} 1 stroke on holes ranked 1-${extra}.`;
    const baseText = `${direction} ${base} stroke${base === 1 ? "" : "s"} on every hole`;
    const extraText = extra ? `, plus 1 more on holes ranked 1-${extra}` : "";
    return `${baseText}${extraText}.`;
  }

  function scoreHole(hole, courseHandicap) {
    const strokes = strokesForHole(courseHandicap, hole.handicap);
    return {
      ...hole,
      strokes,
      target: hole.par + strokes
    };
  }

  function scorecardForTee(tee, courseHandicap) {
    const holes = tee.holes.map(hole => scoreHole(hole, courseHandicap));
    const summarize = segment => {
      const par = segment.reduce((sum, hole) => sum + hole.par, 0);
      const strokes = segment.reduce((sum, hole) => sum + hole.strokes, 0);
      return {
        par,
        strokes,
        target: par + strokes
      };
    };

    return {
      holes,
      out: summarize(holes.slice(0, 9)),
      in: summarize(holes.slice(9, 18)),
      total: summarize(holes)
    };
  }

  const api = {
    calculateTeeResult,
    scorecardForTee,
    scoreHole,
    strokesForHole,
    summarizeStrokes
  };

  global.GolfCalculator = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
