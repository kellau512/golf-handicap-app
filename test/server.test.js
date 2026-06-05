const assert = require("node:assert/strict");
const test = require("node:test");
const {
  coursesFromIndex,
  liveSearchKey,
  normalizeCourse,
  normalizeCourseSummary,
  normalizeHoles,
  sampleCourseMatches,
  sortCoursesByName
} = require("../server");

test("normalizes hole scorecard data from API variants", () => {
  const holes = normalizeHoles([
    { hole_number: "1", par: "4", stroke_index: "7" },
    { hole: 2, par: 5, handicap_index: 1 }
  ]);

  assert.deepEqual(holes, [
    { number: 1, par: 4, handicap: 7 },
    { number: 2, par: 5, handicap: 1 }
  ]);
});

test("normalizes only playable tees with rating, slope, and 18 holes", () => {
  const playableHoles = Array.from({ length: 18 }, (_, index) => ({
    number: index + 1,
    par: 4,
    handicap: index + 1
  }));
  const course = normalizeCourse({
    id: "course-1",
    name: "Test Club",
    state: "CA",
    tees: [
      { id: "blue", rating: 70.1, slope: 125, holes: playableHoles },
      { id: "white", rating: 69.2, slope: 0, holes: playableHoles },
      { id: "red", rating: 68.1, slope: 118, holes: playableHoles.slice(0, 9) }
    ]
  });

  assert.equal(course.tees.length, 1);
  assert.equal(course.tees[0].id, "blue");
});

test("sorts and filters course summaries alphabetically", () => {
  const index = {
    states: {
      CA: {
        courses: [
          normalizeCourseSummary({ id: "z", name: "Zeta Golf", city: "San Jose", state: "CA" }),
          normalizeCourseSummary({ id: "a", name: "Alpha Golf", city: "Oakland", state: "CA" })
        ]
      }
    }
  };

  assert.deepEqual(coursesFromIndex(index, "CA").map(course => course.name), ["Alpha Golf", "Zeta Golf"]);
});

test("uses stable keys for persistent live search cache entries", () => {
  assert.equal(liveSearchKey(" Redwood ", "CA"), "CA|redwood");
});

test("sample fallback respects state and text filters", () => {
  const matches = sampleCourseMatches("pebble", "CA");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "Pebble Beach Golf Links");
  assert.equal(sampleCourseMatches("pebble", "NY").length, 0);
});

test("sortCoursesByName falls back to city and state when names match", () => {
  const sorted = sortCoursesByName([
    { name: "Twin Hills", city: "Z City", state: "CA" },
    { name: "Twin Hills", city: "A City", state: "CA" }
  ]);

  assert.equal(sorted[0].city, "A City");
});
