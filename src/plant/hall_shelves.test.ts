import { describe, expect, it } from "vitest";
import { SHELF, boardTop, cardBox, perRow, placeAt, slotBox } from "./hall_shelves.ts";

// P5a (docs/design/plant_ui.md section 3.3): where a card stands on the shelves of its hall. A hall is a wall of shelves 5 m long and 1.2 m deep (METRES of layout.ts) whose front is its south face; the
// boards are 8, the first at 0.2 m and one every 0.28 m, each 0.04 m thick, so the top of board k is 0.2 + 0.28 k + 0.02 m. A card is laid out for the number of cards the hall holds in the whole run, so a
// place never changes. Every expected value is hand arithmetic on SHELF, for the hall at x 10, z 5 (a footprint 5 by 1.2): the front face is z 6.2 and a card stands 0.12 m inside it, at z 6.08; the
// shelf has a margin of 0.2 m at each end, so the cards share 4.6 m.
//   8 cards: one in a row; a pitch of 4.6 m, a card 0.053 m wide (the widest) and 0.18 m tall (3.4 times its width is 0.1802 m, and 0.18 is the tallest).
//   394 cards (the default run): 50 in a row (394 / 8 is 49.25); a pitch of 0.092 m; the same card, as 0.8 of the pitch (0.0736 m) is wider than 0.053 m.
//   1376 cards (100 reactors): 172 in a row; a pitch of 4.6 / 172 = 0.026744 m; a card 0.8 of that (0.021395 m) wide and 3.4 times that (0.072744 m) tall.

const hall = { x: 10, z: 5, w: 5, d: 1.2, h: 2.4 };
const near = (a: number | undefined, b: number): void => expect(a).toBeCloseTo(b, 9);

describe("The boards", () => {
  it("Given 8 boards from 0.2 m, 0.28 m apart and 0.04 m thick Then the tops are at 0.22, 0.50, 0.78 ... 2.18 m", () => {
    expect(SHELF.rows).toBe(8);
    near(boardTop(0), 0.22);
    near(boardTop(1), 0.5);
    near(boardTop(7), 2.18);
  });
});

describe("The cells of a hall", () => {
  it("Given the number of cards the hall holds Then a row holds it divided by 8, rounded up", () => {
    expect([1, 8, 9, 394, 1376].map(perRow)).toEqual([1, 1, 2, 50, 172]);
    expect(perRow(0)).toBe(1);
  });

  it("Given 8 cards Then place 0 stands on the top board (row 0 is the top: the first place is where a reader starts), place 1 on the one below", () => {
    const first = cardBox(hall, 8, 0);
    near(first.x, 12.5); // 10 + 0.2 + 4.6 / 2
    near(first.y, 2.18);
    near(first.z, 6.08);
    near(first.w, 0.053);
    near(first.h, 0.18);
    near(cardBox(hall, 8, 1).y, 1.9); // board 6: 0.2 + 6 * 0.28 + 0.02
    near(cardBox(hall, 8, 7).y, 0.22);
  });

  it("Given 394 cards Then place 49 is the last of the top row at x 14.754 and place 50 the first of the second row", () => {
    near(cardBox(hall, 394, 49).x, 14.754); // 10.2 + 49.5 * 0.092
    near(cardBox(hall, 394, 49).y, 2.18);
    near(cardBox(hall, 394, 50).x, 10.246); // 10.2 + 0.5 * 0.092
    near(cardBox(hall, 394, 50).y, 1.9);
    near(cardBox(hall, 394, 393).y, 0.22); // the 8th row (393 / 50 is 7): the bottom board
  });

  it("Given 1376 cards Then a card is 0.8 of a pitch of 0.026744 m wide and 3.4 times its width tall", () => {
    near(cardBox(hall, 1376, 0).w, 0.8 * (4.6 / 172));
    near(cardBox(hall, 1376, 0).h, 3.4 * 0.8 * (4.6 / 172));
  });

  it("Given any place Then the card stays inside its hall: between its margins in x, in front of the back wall, and its top below the next board", () => {
    for (const total of [1, 8, 45, 394, 1376]) {
      for (let place = 0; place < total; place += Math.max(1, Math.floor(total / 40))) {
        const b = cardBox(hall, total, place);
        expect(b.x - b.w / 2, `${total}/${place}`).toBeGreaterThanOrEqual(hall.x + SHELF.margin - 1e-9);
        expect(b.x + b.w / 2).toBeLessThanOrEqual(hall.x + hall.w - SHELF.margin + 1e-9);
        expect(b.z).toBeGreaterThan(hall.z);
        expect(b.z).toBeLessThan(hall.z + hall.d);
        expect(b.y + b.h).toBeLessThan(b.y + SHELF.step - SHELF.thick);
      }
    }
  });
});

describe("The slots on the face of a card", () => {
  it("Given a card of 0.18 m Then four squares of 0.18 of its height (0.0324 m) go down its face, 0.042 of its height (0.00756 m) apart, above a bar of 0.07 of its height (0.0126 m) for the knowable mark", () => {
    const card = cardBox(hall, 8, 0); // y 2.18, h 0.18
    const top = slotBox(card, 0);
    near(top.size, 0.0324);
    near(top.y, 2.18 + 0.18 - 0.00756 - 0.0324 / 2); // the centre of the first square, one gap under the top: 2.33624
    near(slotBox(card, 1).y, top.y - (0.0324 + 0.00756));
    near(slotBox(card, 3).y, top.y - 3 * (0.0324 + 0.00756));
    near(slotBox(card, 3).y - 0.0324 / 2 - 2.18, 0.0126 + 0.00756); // the last square clears the bar by one gap: 0.02016 m above the foot
    expect(slotBox(card, 0).x).toBe(card.x);
    expect(slotBox(card, 0).z).toBeGreaterThan(card.z); // in front of the plate
  });
});

describe("Which place a point of the shelf face belongs to", () => {
  it("Given 8 cards, one to a row Then a point inside the margins in x and over board 7 up to board 6 is place 0, over board 6 place 1", () => {
    expect(placeAt(hall, 8, 12.5, 2.3)).toBe(0);
    expect(placeAt(hall, 8, 10.3, 2.25)).toBe(0);
    expect(placeAt(hall, 8, 12.5, 1.89)).toBe(2); // 1.62 to 1.90 is row 2 (the space above its card): 1.89 is under the top of board 6 (1.90) and over the top of board 5 (1.62)
    expect(placeAt(hall, 8, 12.5, 1.92)).toBe(1);
  });

  it("Given 394 cards Then the centre of a card is its own place, and so is any point of its pitch", () => {
    for (const place of [0, 1, 49, 50, 200, 393]) {
      const b = cardBox(hall, 394, place);
      expect(placeAt(hall, 394, b.x, b.y + b.h / 2), `${place}`).toBe(place);
      expect(placeAt(hall, 394, b.x + 0.04, b.y + 0.01), `${place} right`).toBe(place);
      expect(placeAt(hall, 394, b.x - 0.04, b.y + 0.01), `${place} left`).toBe(place);
    }
  });

  it("Given a point off the shelves (beyond a margin, under the lowest board, over the highest) or past the last card Then there is no place", () => {
    expect(placeAt(hall, 394, 10.1, 2.3)).toBeNull();
    expect(placeAt(hall, 394, 14.95, 2.3)).toBeNull();
    expect(placeAt(hall, 394, 12.5, 0.1)).toBeNull();
    expect(placeAt(hall, 394, 12.5, 2.5)).toBeNull(); // over the top board's reach: 2.18 + 0.28 is 2.46
  });

  it("Given 394 cards and the last row holds 44 of them Then a point over a column the last row does not fill has no place", () => {
    // row 7 holds places 350 to 393, that is columns 0 to 43; column 44 starts at x 10.2 + 44 * 0.092 = 14.248
    expect(placeAt(hall, 394, 14.3, 0.3)).toBeNull();
    expect(placeAt(hall, 394, 14.1, 0.3)).toBe(350 + 42);
  });
});
