import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { addSection } from "../../src/tools/add-section.ts";
import { deleteSection } from "../../src/tools/delete-section.ts";
import { movePlace } from "../../src/tools/move-place.ts";
import { reorderPlaces } from "../../src/tools/reorder-places.ts";
import { reorderSections } from "../../src/tools/reorder-sections.ts";
import { updateSection } from "../../src/tools/update-section.ts";
import { isPlaceBlock, type TripPlan } from "../../src/types.ts";

function makeTrip(): TripPlan {
  return {
    id: 1,
    key: "organize",
    title: "Organise me",
    userId: 7,
    privacy: "private",
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    days: 2,
    placeCount: 4,
    schemaVersion: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    itinerary: {
      sections: [
        {
          id: 10,
          type: "textOnly",
          mode: "placeList",
          heading: "Notes",
          date: null,
          blocks: [],
        },
        {
          id: 20,
          type: "normal",
          mode: "placeList",
          heading: "Places to visit",
          date: null,
          blocks: [
            {
              id: 101,
              type: "place",
              place: {
                name: "Museum Alpha",
                place_id: "alpha",
                geometry: { location: { lat: 1, lng: 2 } },
              },
              text: { ops: [{ insert: "Keep this note\n" }] },
              startTime: "09:00",
              endTime: "10:30",
              imageKeys: ["photo-key"],
              hotel: {
                checkIn: "2026-06-01",
                checkOut: "2026-06-02",
                travelerNames: ["Ada"],
                confirmationNumber: "ABC123",
              },
            },
          ],
        },
        {
          id: 30,
          type: "normal",
          mode: "placeList",
          heading: "Food",
          date: null,
          blocks: [
            {
              id: 102,
              type: "place",
              place: { name: "Bakery Beta", place_id: "beta" },
              startTime: "08:00",
            },
            {
              id: 900,
              type: "note",
              text: { ops: [{ insert: "Walk between stops\n" }] },
            },
            {
              id: 103,
              type: "place",
              place: { name: "Cafe Gamma", place_id: "gamma" },
              text: { ops: [{ insert: "Window seat\n" }] },
            },
          ],
        },
        {
          id: 40,
          type: "normal",
          mode: "dayPlan",
          heading: "Arrival",
          date: "2026-06-01",
          blocks: [
            {
              id: 104,
              type: "place",
              place: { name: "Day Delta", place_id: "delta" },
            },
          ],
        },
        {
          id: 50,
          type: "normal",
          mode: "dayPlan",
          heading: "",
          date: "2026-06-02",
          blocks: [],
        },
      ],
    },
  };
}

function makeFakeContext(
  trip = makeTrip(),
  options: { submitError?: Error } = {},
): {
  ctx: AppContext;
  snapshot: () => TripPlan;
  submittedOps: Json0Op[][];
  invalidations: () => number;
} {
  const submittedOps: Json0Op[][] = [];
  const entry = { snapshot: structuredClone(trip), version: 1, geos: [] };
  let invalidations = 0;
  const client = {
    isSubscribed: true,
    version: 1,
    async submit(ops: Json0Op[]) {
      submittedOps.push(ops);
      if (options.submitError) throw options.submitError;
      this.version += 1;
    },
  };
  const ctx = {
    userId: 7,
    pool: { get: () => client },
    tripCache: {
      getEntry: async () => entry,
      applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
        entry.snapshot = applyOp(entry.snapshot, ops);
        entry.version = version;
      },
      invalidate: () => {
        invalidations += 1;
      },
    },
  } as unknown as AppContext;
  return {
    ctx,
    snapshot: () => entry.snapshot,
    submittedOps,
    invalidations: () => invalidations,
  };
}

function customHeadings(trip: TripPlan): string[] {
  return trip.itinerary.sections
    .filter((section) => section.id === 10 || section.id === 30)
    .map((section) => section.heading);
}

describe("custom section lifecycle", () => {
  it("creates, renames, and deletes a uniquely named custom section", async () => {
    const fake = makeFakeContext();
    const added = await addSection(fake.ctx, {
      trip_key: "organize",
      heading: "Sights",
      after_section: "Food",
    });
    expect(added.isError).toBeUndefined();
    expect(fake.snapshot().itinerary.sections[3]!.heading).toBe("Sights");

    const renamed = await updateSection(fake.ctx, {
      trip_key: "organize",
      section: "Sights",
      heading: "Must See",
    });
    expect(renamed.isError).toBeUndefined();
    expect(fake.snapshot().itinerary.sections[3]!.heading).toBe("Must See");

    const deleted = await deleteSection(fake.ctx, {
      trip_key: "organize",
      section: "Must See",
    });
    expect(deleted.isError).toBeUndefined();
    expect(fake.snapshot().itinerary.sections.some((section) => section.heading === "Must See"))
      .toBe(false);
  });

  it("rejects duplicate headings on create and rename", async () => {
    const fake = makeFakeContext();
    const added = await addSection(fake.ctx, {
      trip_key: "organize",
      heading: "food",
    });
    expect(added.isError).toBe(true);

    const renamed = await updateSection(fake.ctx, {
      trip_key: "organize",
      section: "Notes",
      heading: "FOOD",
    });
    expect(renamed.isError).toBe(true);
    expect(fake.submittedOps).toHaveLength(0);
  });

  it("reserves the default list aliases so custom sections remain addressable", async () => {
    const fake = makeFakeContext();
    const added = await addSection(fake.ctx, {
      trip_key: "organize",
      heading: "Places",
    });
    expect(added.isError).toBe(true);
    const renamed = await updateSection(fake.ctx, {
      trip_key: "organize",
      section: "Notes",
      heading: "Places to visit",
    });
    expect(renamed.isError).toBe(true);
    expect(fake.submittedOps).toHaveLength(0);
  });

  it("rejects ambiguous and day-section delete targets", async () => {
    const trip = makeTrip();
    trip.itinerary.sections.splice(1, 0, {
      id: 11,
      type: "textOnly",
      mode: "placeList",
      heading: "Notes",
      date: null,
      blocks: [],
    });
    const ambiguous = makeFakeContext(trip);
    const ambiguousResult = await deleteSection(ambiguous.ctx, {
      trip_key: "organize",
      section: "Notes",
    });
    expect(ambiguousResult.isError).toBe(true);
    expect(ambiguousResult.content[0]!.text).toContain("ambiguous");
    expect(ambiguous.submittedOps).toHaveLength(0);

    const day = makeFakeContext();
    const dayResult = await deleteSection(day.ctx, {
      trip_key: "organize",
      section: "Arrival",
    });
    expect(dayResult.isError).toBe(true);
    expect(dayResult.content[0]!.text).toContain("Day sections");
    expect(day.submittedOps).toHaveLength(0);
  });
});

describe("movePlace", () => {
  it("moves the original block to a custom list at a requested position with metadata intact", async () => {
    const fake = makeFakeContext();
    const original = structuredClone(fake.snapshot().itinerary.sections[1]!.blocks[0]!);
    const result = await movePlace(fake.ctx, {
      trip_key: "organize",
      place_ref: "Museum Alpha",
      target_section: "Food",
      position: 2,
    });
    expect(result.isError).toBeUndefined();
    expect(fake.snapshot().itinerary.sections[1]!.blocks).toHaveLength(0);
    const foodPlaces = fake.snapshot().itinerary.sections[2]!.blocks.filter(isPlaceBlock);
    expect(foodPlaces.map((block) => block.place.name)).toEqual([
      "Bakery Beta",
      "Museum Alpha",
      "Cafe Gamma",
    ]);
    expect(foodPlaces[1]).toEqual(original);
  });

  it("moves a place to a valid day and rejects an unknown day", async () => {
    const success = makeFakeContext();
    const moved = await movePlace(success.ctx, {
      trip_key: "organize",
      place_ref: "Museum Alpha",
      target_day: "day 2",
    });
    expect(moved.isError).toBeUndefined();
    expect(success.snapshot().itinerary.sections[4]!.blocks[0]!.id).toBe(101);

    const invalid = makeFakeContext();
    const result = await movePlace(invalid.ctx, {
      trip_key: "organize",
      place_ref: "Museum Alpha",
      target_day: "day 9",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("out of range");
    expect(invalid.submittedOps).toHaveLength(0);

    const unknownSection = makeFakeContext();
    const sectionResult = await movePlace(unknownSection.ctx, {
      trip_key: "organize",
      place_ref: "Museum Alpha",
      target_section: "Does not exist",
    });
    expect(sectionResult.isError).toBe(true);
    expect(sectionResult.content[0]!.text).toContain("not found");
    expect(unknownSection.submittedOps).toHaveLength(0);
  });

  it("fails safely for ambiguous places and duplicate destination headings", async () => {
    const duplicatePlaceTrip = makeTrip();
    duplicatePlaceTrip.itinerary.sections[3]!.blocks.push(
      structuredClone(duplicatePlaceTrip.itinerary.sections[1]!.blocks[0]!),
    );
    duplicatePlaceTrip.itinerary.sections[3]!.blocks[1]!.id = 105;
    const ambiguousPlace = makeFakeContext(duplicatePlaceTrip);
    const placeResult = await movePlace(ambiguousPlace.ctx, {
      trip_key: "organize",
      place_ref: "Museum Alpha",
      target_section: "Food",
    });
    expect(placeResult.isError).toBe(true);
    expect(placeResult.content[0]!.text).toContain("ambiguous");
    expect(ambiguousPlace.submittedOps).toHaveLength(0);

    const duplicateSectionTrip = makeTrip();
    duplicateSectionTrip.itinerary.sections.splice(3, 0, {
      id: 31,
      type: "normal",
      mode: "placeList",
      heading: "Food",
      date: null,
      blocks: [],
    });
    const ambiguousSection = makeFakeContext(duplicateSectionTrip);
    const sectionResult = await movePlace(ambiguousSection.ctx, {
      trip_key: "organize",
      place_ref: "Museum Alpha",
      target_section: "Food",
    });
    expect(sectionResult.isError).toBe(true);
    expect(sectionResult.content[0]!.text).toContain("ambiguous");
    expect(ambiguousSection.submittedOps).toHaveLength(0);
  });

  it("invalidates the cache and leaves the local snapshot unchanged on API failure", async () => {
    const fake = makeFakeContext(makeTrip(), { submitError: new Error("API unavailable") });
    const before = structuredClone(fake.snapshot());
    const result = await movePlace(fake.ctx, {
      trip_key: "organize",
      place_ref: "Museum Alpha",
      target_section: "Food",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("API unavailable");
    expect(fake.snapshot()).toEqual(before);
    expect(fake.invalidations()).toBe(1);
  });
});

describe("reorderPlaces", () => {
  it("supports the first and last boundary positions while preserving place blocks", async () => {
    const first = makeFakeContext();
    const gamma = structuredClone(first.snapshot().itinerary.sections[2]!.blocks[2]!);
    const firstResult = await reorderPlaces(first.ctx, {
      trip_key: "organize",
      section: "Food",
      place_ref: "Cafe Gamma",
      position: 1,
    });
    expect(firstResult.isError).toBeUndefined();
    const firstPlaces = first.snapshot().itinerary.sections[2]!.blocks.filter(isPlaceBlock);
    expect(firstPlaces.map((block) => block.place.name)).toEqual([
      "Cafe Gamma",
      "Bakery Beta",
    ]);
    expect(firstPlaces[0]).toEqual(gamma);

    const last = makeFakeContext();
    const beta = structuredClone(last.snapshot().itinerary.sections[2]!.blocks[0]!);
    const lastResult = await reorderPlaces(last.ctx, {
      trip_key: "organize",
      section: "Food",
      place_ref: "Bakery Beta",
      position: 2,
    });
    expect(lastResult.isError).toBeUndefined();
    const lastPlaces = last.snapshot().itinerary.sections[2]!.blocks.filter(isPlaceBlock);
    expect(lastPlaces.map((block) => block.place.name)).toEqual([
      "Cafe Gamma",
      "Bakery Beta",
    ]);
    expect(lastPlaces[1]).toEqual(beta);
  });

  it("rejects invalid positions, unknown days, and ambiguous names without mutation", async () => {
    const invalidPosition = makeFakeContext();
    const positionResult = await reorderPlaces(invalidPosition.ctx, {
      trip_key: "organize",
      section: "Food",
      place_ref: "Bakery Beta",
      position: 3,
    });
    expect(positionResult.isError).toBe(true);
    expect(positionResult.content[0]!.text).toContain("1 to 2");

    const invalidDay = makeFakeContext();
    const dayResult = await reorderPlaces(invalidDay.ctx, {
      trip_key: "organize",
      day: "2027-01-01",
      place_ref: "Day Delta",
      position: 1,
    });
    expect(dayResult.isError).toBe(true);

    const invalidSection = makeFakeContext();
    const sectionResult = await reorderPlaces(invalidSection.ctx, {
      trip_key: "organize",
      section: "Does not exist",
      place_ref: "Bakery Beta",
      position: 1,
    });
    expect(sectionResult.isError).toBe(true);

    const duplicateTrip = makeTrip();
    duplicateTrip.itinerary.sections[2]!.blocks.push({
      id: 106,
      type: "place",
      place: { name: "Bakery Beta", place_id: "beta-2" },
    });
    const ambiguous = makeFakeContext(duplicateTrip);
    const ambiguousResult = await reorderPlaces(ambiguous.ctx, {
      trip_key: "organize",
      section: "Food",
      place_ref: "Bakery Beta",
      position: 1,
    });
    expect(ambiguousResult.isError).toBe(true);
    expect(ambiguousResult.content[0]!.text).toContain("ambiguous");
    expect(invalidPosition.submittedOps).toHaveLength(0);
    expect(invalidDay.submittedOps).toHaveLength(0);
    expect(invalidSection.submittedOps).toHaveLength(0);
    expect(ambiguous.submittedOps).toHaveLength(0);
  });
});

describe("reorderSections", () => {
  it("moves custom lists to first and last positions without rewriting their content", async () => {
    const first = makeFakeContext();
    const food = structuredClone(first.snapshot().itinerary.sections[2]!);
    const firstResult = await reorderSections(first.ctx, {
      trip_key: "organize",
      section: "Food",
      position: 1,
    });
    expect(firstResult.isError).toBeUndefined();
    expect(customHeadings(first.snapshot())).toEqual(["Food", "Notes"]);
    expect(first.snapshot().itinerary.sections.find((section) => section.id === 30)).toEqual(food);

    const last = makeFakeContext();
    const lastResult = await reorderSections(last.ctx, {
      trip_key: "organize",
      section: "Notes",
      position: 2,
    });
    expect(lastResult.isError).toBeUndefined();
    expect(customHeadings(last.snapshot())).toEqual(["Food", "Notes"]);
  });

  it("rejects non-custom, duplicate, and out-of-range targets", async () => {
    const base = makeFakeContext();
    const day = await reorderSections(base.ctx, {
      trip_key: "organize",
      section: "Arrival",
      position: 1,
    });
    expect(day.isError).toBe(true);
    const outOfRange = await reorderSections(base.ctx, {
      trip_key: "organize",
      section: "Food",
      position: 3,
    });
    expect(outOfRange.isError).toBe(true);

    const duplicateTrip = makeTrip();
    duplicateTrip.itinerary.sections.splice(3, 0, {
      id: 31,
      type: "normal",
      mode: "placeList",
      heading: "Food",
      date: null,
      blocks: [],
    });
    const duplicate = makeFakeContext(duplicateTrip);
    const duplicateResult = await reorderSections(duplicate.ctx, {
      trip_key: "organize",
      section: "Food",
      position: 1,
    });
    expect(duplicateResult.isError).toBe(true);
    expect(duplicateResult.content[0]!.text).toContain("ambiguous");
    expect(base.submittedOps).toHaveLength(0);
    expect(duplicate.submittedOps).toHaveLength(0);
  });
});
