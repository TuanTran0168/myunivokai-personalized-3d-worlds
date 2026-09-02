/**
 * Simplified stick-figure layouts of the 12 zodiac constellations, the way
 * star maps draw them. Coordinates are normalized to a unit patch (0..1 on
 * both axes); `lineIndexPairs` connect star indices. `isMajor` marks the
 * bright anchor stars that render bigger, like the glowing knots in classic
 * constellation art. The shapes are recognizable simplifications, not
 * astronomical positions.
 */

export type ConstellationStar = {
  x: number;
  y: number;
  isMajor: boolean;
};

export type ConstellationFigure = {
  name: string;
  stars: ConstellationStar[];
  lineIndexPairs: [number, number][];
};

export const ZODIAC_CONSTELLATIONS: ConstellationFigure[] = [
  {
    name: "Aries",
    stars: [
      { x: 0.05, y: 0.35, isMajor: false },
      { x: 0.4, y: 0.55, isMajor: true },
      { x: 0.75, y: 0.6, isMajor: true },
      { x: 0.92, y: 0.45, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 1],
      [1, 2],
      [2, 3]
    ]
  },
  {
    name: "Taurus",
    stars: [
      { x: 0.5, y: 0.45, isMajor: true }, // Aldebaran at the V's junction
      { x: 0.38, y: 0.55, isMajor: false },
      { x: 0.3, y: 0.5, isMajor: false },
      { x: 0.1, y: 0.85, isMajor: true }, // horn tip
      { x: 0.62, y: 0.6, isMajor: false },
      { x: 0.88, y: 0.9, isMajor: true }, // horn tip
      { x: 0.55, y: 0.2, isMajor: false },
      { x: 0.7, y: 0.08, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 4],
      [4, 5],
      [0, 6],
      [6, 7]
    ]
  },
  {
    name: "Gemini",
    stars: [
      { x: 0.3, y: 0.9, isMajor: true }, // Castor
      { x: 0.55, y: 0.88, isMajor: true }, // Pollux
      { x: 0.28, y: 0.6, isMajor: false },
      { x: 0.52, y: 0.58, isMajor: false },
      { x: 0.22, y: 0.3, isMajor: false },
      { x: 0.5, y: 0.28, isMajor: false },
      { x: 0.12, y: 0.08, isMajor: false },
      { x: 0.62, y: 0.06, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 2],
      [2, 4],
      [4, 6],
      [1, 3],
      [3, 5],
      [5, 7],
      [2, 3]
    ]
  },
  {
    name: "Cancer",
    stars: [
      { x: 0.5, y: 0.5, isMajor: false },
      { x: 0.35, y: 0.85, isMajor: false },
      { x: 0.62, y: 0.72, isMajor: true },
      { x: 0.3, y: 0.2, isMajor: false },
      { x: 0.72, y: 0.1, isMajor: false }
    ],
    lineIndexPairs: [
      [1, 0],
      [2, 0],
      [0, 3],
      [0, 4]
    ]
  },
  {
    name: "Leo",
    stars: [
      { x: 0.85, y: 0.7, isMajor: false }, // sickle top
      { x: 0.75, y: 0.88, isMajor: false },
      { x: 0.6, y: 0.9, isMajor: false },
      { x: 0.52, y: 0.75, isMajor: false },
      { x: 0.62, y: 0.55, isMajor: false },
      { x: 0.6, y: 0.35, isMajor: true }, // Regulus
      { x: 0.28, y: 0.5, isMajor: false },
      { x: 0.08, y: 0.32, isMajor: true }, // Denebola
      { x: 0.3, y: 0.25, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [4, 6],
      [6, 7],
      [7, 8],
      [8, 5]
    ]
  },
  {
    name: "Virgo",
    stars: [
      { x: 0.15, y: 0.75, isMajor: false },
      { x: 0.35, y: 0.65, isMajor: false },
      { x: 0.5, y: 0.5, isMajor: false },
      { x: 0.42, y: 0.25, isMajor: true }, // Spica
      { x: 0.68, y: 0.62, isMajor: false },
      { x: 0.88, y: 0.5, isMajor: false },
      { x: 0.6, y: 0.85, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
      [4, 5],
      [1, 6]
    ]
  },
  {
    name: "Libra",
    stars: [
      { x: 0.5, y: 0.85, isMajor: false },
      { x: 0.25, y: 0.6, isMajor: true },
      { x: 0.72, y: 0.62, isMajor: true },
      { x: 0.2, y: 0.15, isMajor: false },
      { x: 0.78, y: 0.12, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 3],
      [2, 4]
    ]
  },
  {
    name: "Scorpius",
    stars: [
      { x: 0.85, y: 0.9, isMajor: false }, // claws
      { x: 0.9, y: 0.72, isMajor: false },
      { x: 0.78, y: 0.78, isMajor: true }, // Antares
      { x: 0.62, y: 0.62, isMajor: false },
      { x: 0.52, y: 0.45, isMajor: false },
      { x: 0.45, y: 0.25, isMajor: false },
      { x: 0.35, y: 0.1, isMajor: false },
      { x: 0.18, y: 0.08, isMajor: false },
      { x: 0.08, y: 0.2, isMajor: true } // stinger
    ],
    lineIndexPairs: [
      [0, 2],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8]
    ]
  },
  {
    name: "Sagittarius",
    stars: [
      { x: 0.25, y: 0.3, isMajor: false }, // teapot base
      { x: 0.45, y: 0.25, isMajor: false },
      { x: 0.6, y: 0.35, isMajor: false },
      { x: 0.55, y: 0.6, isMajor: true }, // lid
      { x: 0.35, y: 0.55, isMajor: false },
      { x: 0.15, y: 0.5, isMajor: false }, // spout
      { x: 0.78, y: 0.55, isMajor: false }, // handle
      { x: 0.8, y: 0.3, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
      [4, 5],
      [5, 0],
      [2, 7],
      [7, 6],
      [6, 3]
    ]
  },
  {
    name: "Capricorn",
    stars: [
      { x: 0.08, y: 0.7, isMajor: true },
      { x: 0.3, y: 0.55, isMajor: false },
      { x: 0.55, y: 0.42, isMajor: false },
      { x: 0.85, y: 0.35, isMajor: false },
      { x: 0.92, y: 0.62, isMajor: true },
      { x: 0.6, y: 0.72, isMajor: false },
      { x: 0.32, y: 0.78, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 0]
    ]
  },
  {
    name: "Aquarius",
    stars: [
      { x: 0.1, y: 0.6, isMajor: false },
      { x: 0.3, y: 0.72, isMajor: true },
      { x: 0.48, y: 0.6, isMajor: false },
      { x: 0.65, y: 0.72, isMajor: false },
      { x: 0.85, y: 0.6, isMajor: false },
      { x: 0.55, y: 0.35, isMajor: false },
      { x: 0.45, y: 0.1, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [2, 5],
      [5, 6]
    ]
  },
  {
    name: "Pisces",
    stars: [
      { x: 0.1, y: 0.85, isMajor: false }, // west fish
      { x: 0.2, y: 0.95, isMajor: false },
      { x: 0.25, y: 0.8, isMajor: false },
      { x: 0.35, y: 0.55, isMajor: false },
      { x: 0.5, y: 0.3, isMajor: true }, // the knot
      { x: 0.68, y: 0.22, isMajor: false },
      { x: 0.85, y: 0.15, isMajor: false },
      { x: 0.95, y: 0.28, isMajor: false },
      { x: 0.88, y: 0.38, isMajor: false }
    ],
    lineIndexPairs: [
      [0, 1],
      [1, 2],
      [2, 0],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 5]
    ]
  }
];
