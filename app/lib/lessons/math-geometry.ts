import type { Lesson } from './types';

export const MATH_GEOMETRY_LESSONS: Lesson[] = [
  {
    skill: 'Circles',
    tagline:
      'Work with the circle equation, radius, center, arc length, sector area, and central angles.',
    overview: [
      'Circle questions on the Digital SAT come in two flavors. The first is coordinate-plane algebra: an equation in the form (x - h)^2 + (y - k)^2 = r^2 gives you a circle centered at (h, k) with radius r, and you often have to complete the square to get there from an expanded equation. The second is measurement: arc length and sector area, which are just fractions of the full circumference and full area set by the central angle.',
      'Keep the two toolkits separate but ready. For the algebra, your only real move is completing the square on the x-terms and the y-terms. For the measurement, remember that an arc or sector cut by a central angle of theta degrees is theta/360 of the whole circle. The Math reference sheet gives you the area (pi times r^2) and circumference (2 pi r) formulas, so you never have to recall those from memory.',
    ],
    strategies: [
      {
        title: 'Complete the square to find center and radius',
        body: 'Given x^2 + y^2 + Dx + Ey + F = 0, group the x-terms and y-terms, then add (D/2)^2 and (E/2)^2 to both sides. The result (x - h)^2 + (y - k)^2 = r^2 hands you the center (h, k) and radius r = sqrt of the right side.',
      },
      {
        title: 'Use the central angle as a fraction',
        body: 'A central angle of theta degrees claims theta/360 of the circle. Arc length is (theta/360) times 2 pi r; sector area is (theta/360) times pi r^2. Set up the fraction first, then plug in.',
      },
      {
        title: 'Read the sign of h and k carefully',
        body: 'The standard form subtracts the center coordinates: (x - h)^2 + (y - k)^2. So (x + 3)^2 means h = -3, not +3. Flip the sign inside the parentheses to read the actual center.',
      },
      {
        title: 'Check whether they want radius or diameter',
        body: 'The equation gives you r^2 on the right, so you take a square root to get the radius. If the question asks for diameter, double it; if it asks for area or circumference, use the reference-sheet formula.',
      },
    ],
    workedExample: {
      prompt:
        'In the xy-plane, the graph of the equation x^2 + y^2 - 6x + 8y - 11 = 0 is a circle. What is the radius of the circle?',
      choices: ['5', '6', '11', '36'],
      correct: '6',
      walkthrough: [
        'Group the x-terms and y-terms: (x^2 - 6x) + (y^2 + 8y) = 11.',
        'Complete the square: half of -6 is -3, squared is 9; half of 8 is 4, squared is 16. Add both to each side: (x^2 - 6x + 9) + (y^2 + 8y + 16) = 11 + 9 + 16.',
        'That gives (x - 3)^2 + (y + 4)^2 = 36, so r^2 = 36.',
        'The radius is sqrt(36) = 6.',
      ],
    },
    traps: [
      'Reporting r^2 (here 36) as the radius instead of taking the square root.',
      'Forgetting to add the completed-square constants to the right side as well as the left.',
      'Misreading the center sign, treating (y + 4)^2 as k = +4 instead of -4.',
      'Using the full-circle area or circumference when the question only asks for a sector or arc.',
    ],
  },
  {
    skill: 'Geometry (Area)',
    tagline:
      'Find areas of rectangles, triangles, circles, and composite or shaded regions built from them.',
    overview: [
      'Area questions ask you to measure a two-dimensional region. The region is often a composite: a shape with a piece added or a piece removed, or two familiar shapes glued together. The strategy is almost always the same — break the region into rectangles, triangles, and circles you can measure, then add or subtract.',
      'You are not expected to memorize every formula. The Math reference sheet lists the area of a rectangle (length times width), a triangle (one-half base times height), and a circle (pi times r^2). Your work is choosing the right decomposition and reading the correct base, height, and radius from the description. For a shaded region, compute the whole shape, then subtract the unshaded hole.',
    ],
    strategies: [
      {
        title: 'Decompose before you compute',
        body: 'Split a composite figure into non-overlapping rectangles and triangles, find each area, and add them. Sketch it from the description so you can label every base and height.',
      },
      {
        title: 'Subtract for a shaded region',
        body: 'When a smaller shape is cut out of a larger one, find the area of the whole and subtract the area of the removed piece. Shaded = outer - inner.',
      },
      {
        title: 'Match base to its perpendicular height',
        body: 'For a triangle, the height must be measured perpendicular to the base you chose. Do not multiply a base by a slanted side length; use the perpendicular distance.',
      },
      {
        title: 'Keep the units consistent',
        body: 'Convert all lengths to the same unit before multiplying, and remember area comes out in square units. Mixing feet and inches, or reporting a length as an area, is a classic miss.',
      },
    ],
    workedExample: {
      prompt:
        'A rectangular garden is 14 meters long and 9 meters wide. A triangular flower bed with a base of 6 meters and a height of 4 meters is planted inside the garden. The rest of the garden is covered with grass. What is the area, in square meters, of the grass-covered region?',
      correct: '114',
      walkthrough: [
        'The area of the whole rectangular garden is 14 times 9 = 126 square meters.',
        'The triangular flower bed has area one-half times base times height = (1/2)(6)(4) = 12 square meters.',
        'The grass covers everything except the flower bed, so subtract: 126 - 12 = 114 square meters.',
      ],
    },
    traps: [
      'Forgetting the one-half factor and treating the triangle as base times height.',
      'Adding the triangle instead of subtracting it from the rectangle.',
      'Using a slanted side as the height rather than the perpendicular height.',
      'Reporting the outer rectangle area and forgetting to remove the flower bed.',
    ],
  },
  {
    skill: 'Geometry (Triangles)',
    tagline:
      'Apply the Pythagorean theorem, similar-triangle ratios, and special right triangles.',
    overview: [
      'Triangle questions lean on three ideas: the angles of a triangle sum to 180 degrees, the Pythagorean theorem relates the legs and hypotenuse of a right triangle, and similar triangles have proportional corresponding sides. Recognizing which idea a problem needs is most of the battle.',
      'Similar triangles are a favorite. When two triangles have the same angles (often created by parallel lines or a shared angle), their corresponding sides are in a constant ratio, so you can set up a proportion and solve for the missing length. The Math reference sheet gives you the special right-triangle relationships (the 30-60-90 and 45-45-90 side ratios) and the Pythagorean setup, so lean on it rather than guessing.',
    ],
    strategies: [
      {
        title: 'Set up a proportion for similar triangles',
        body: 'Match corresponding sides in the same order and write them as equal ratios. If AB corresponds to DE and BC corresponds to EF, then AB/DE = BC/EF, and you cross-multiply to solve.',
      },
      {
        title: 'Reach for the special right triangles',
        body: 'A 45-45-90 triangle has sides in the ratio 1 : 1 : sqrt(2); a 30-60-90 has sides 1 : sqrt(3) : 2. Spotting these lets you find a side without the full Pythagorean computation.',
      },
      {
        title: 'Use the 180-degree angle sum',
        body: 'If two angles of a triangle are known, the third is 180 minus their sum. Combine this with vertical angles and parallel-line rules to unlock the angles you need.',
      },
      {
        title: 'Confirm the correspondence direction',
        body: 'In similar triangles, the largest side of one matches the largest side of the other. Line up the vertices in the same order so you divide matching sides, not mismatched ones.',
      },
    ],
    workedExample: {
      prompt:
        'Triangle ABC is similar to triangle DEF, where side AB corresponds to side DE and side BC corresponds to side EF. If AB = 8, BC = 12, and DE = 12, what is the length of side EF?',
      choices: ['8', '16', '18', '24'],
      correct: '18',
      walkthrough: [
        'Corresponding sides of similar triangles are proportional, so AB/DE = BC/EF.',
        'Substitute the known lengths: 8/12 = 12/EF.',
        'Cross-multiply: 8 times EF = 12 times 12 = 144, so EF = 144/8 = 18.',
        'The length of side EF is 18.',
      ],
    },
    traps: [
      'Setting up the proportion with mismatched sides (dividing AB by EF instead of by DE).',
      'Inverting the ratio and solving 12/8 = 12/EF, which gives a shape that is smaller, not larger.',
      'Assuming the triangles are congruent and copying BC = 12 straight over to EF.',
      'Applying the Pythagorean theorem when the triangles are not stated to be right triangles.',
    ],
  },
  {
    skill: 'Volume',
    tagline:
      'Compute volumes of prisms, cylinders, cones, spheres, and pyramids from their dimensions.',
    overview: [
      'Volume measures the space inside a three-dimensional solid, in cubic units. The Digital SAT tests the standard solids: rectangular prisms (boxes), cylinders, cones, spheres, and pyramids. You rarely have to recall a formula cold, because the Math reference sheet prints all of them, including the one-third factor on the cone and pyramid and the four-thirds on the sphere.',
      'The work is identifying the solid, reading its dimensions, and substituting carefully. The two most common slips are forgetting a fractional coefficient (the 1/3 for a cone, the 4/3 for a sphere) and confusing radius with diameter. Many answers are left in terms of pi, so know whether the question wants an exact pi expression or a decimal.',
    ],
    strategies: [
      {
        title: 'Name the solid, then pull the formula',
        body: 'Decide whether it is a prism, cylinder, cone, sphere, or pyramid before reaching for the reference sheet. Cylinder volume is pi r^2 h; a cone is one-third of that; a sphere is (4/3) pi r^3.',
      },
      {
        title: 'Never skip the fractional coefficient',
        body: 'A cone and a pyramid carry a factor of 1/3, and a sphere carries 4/3. Leaving these out inflates the answer to a full cylinder or prism, a trap the wrong choices are built around.',
      },
      {
        title: 'Halve a diameter before using it',
        body: 'Formulas use the radius. If the problem gives a diameter, divide by 2 first, and remember the radius gets cubed for a sphere, so a wrong radius errors badly.',
      },
      {
        title: 'Decide exact versus decimal early',
        body: 'If the answer choices contain pi, keep pi symbolic and do not multiply it out. If they are decimals, use 3.14 or the calculator only at the very end.',
      },
    ],
    workedExample: {
      prompt:
        'A right circular cone has a base radius of 6 centimeters and a height of 10 centimeters. What is the volume of the cone, in cubic centimeters?',
      choices: ['60 pi', '120 pi', '240 pi', '360 pi'],
      correct: '120 pi',
      walkthrough: [
        'The volume of a cone is (1/3) pi r^2 h, from the reference sheet.',
        'Substitute r = 6 and h = 10: (1/3) pi (6)^2 (10) = (1/3) pi (36)(10).',
        'Multiply inside: 36 times 10 = 360, so the volume is (1/3)(360) pi = 120 pi.',
        'The volume is 120 pi cubic centimeters.',
      ],
    },
    traps: [
      'Dropping the 1/3 factor and computing the cylinder volume 360 pi instead.',
      'Squaring the height or forgetting to square the radius.',
      'Using a given diameter directly as the radius.',
      'Multiplying pi out to a decimal when the choices are written in terms of pi.',
    ],
  },
  {
    skill: 'Right Triangle Trigonometry',
    tagline:
      'Use sine, cosine, and tangent ratios and the complementary-angle relationship in right triangles.',
    overview: [
      'Right-triangle trig is built on SOH-CAH-TOA: for an acute angle in a right triangle, sine is opposite over hypotenuse, cosine is adjacent over hypotenuse, and tangent is opposite over adjacent. Once you label the sides relative to the angle you care about, the ratio you need falls right out.',
      'One relationship shows up constantly on the Digital SAT: the two acute angles of a right triangle are complementary (they add to 90 degrees), and the sine of one equals the cosine of the other. So sin(x) = cos(90 - x). Recognizing this lets you answer a question about cosine using a sine value you were handed, with no side lengths at all.',
    ],
    strategies: [
      {
        title: 'Label opposite, adjacent, and hypotenuse',
        body: 'Fix the angle you are working with, then tag the side across from it as opposite, the non-hypotenuse side touching it as adjacent, and the longest side as the hypotenuse. The correct ratio follows from SOH-CAH-TOA.',
      },
      {
        title: 'Use the cofunction identity for complementary angles',
        body: 'The two acute angles of a right triangle sum to 90 degrees, so sin(x) = cos(90 - x) and cos(x) = sin(90 - x). If they give sin of one angle and ask for cos of the other, the values are equal.',
      },
      {
        title: 'Find the third side with the Pythagorean theorem',
        body: 'If a ratio needs a side you do not have, recover it with a^2 + b^2 = c^2. A 5-12-13 or 3-4-5 triangle often hides in these problems.',
      },
      {
        title: 'Keep ratios as fractions',
        body: 'Leave sine, cosine, and tangent as exact fractions like 5/13 unless a decimal is requested. This avoids rounding error and matches the fraction form the choices usually take.',
      },
    ],
    workedExample: {
      prompt:
        'In right triangle ABC, the right angle is at C, and the value of sin A is 12/13. What is the value of cos B?',
      choices: ['5/13', '5/12', '12/13', '13/12'],
      correct: '12/13',
      walkthrough: [
        'In triangle ABC the angle at C is 90 degrees, so angles A and B are complementary: A + B = 90 degrees.',
        'For complementary angles, the sine of one equals the cosine of the other: cos B = sin(90 - B) = sin A.',
        'Since sin A = 12/13, it follows that cos B = 12/13.',
      ],
    },
    traps: [
      'Confusing sine and cosine and reporting the "other" leg ratio 5/13.',
      'Inverting the ratio to 13/12, which no basic trig ratio produces (each is at most 1 for an acute angle).',
      'Forgetting that A and B are complementary and trying to build side lengths unnecessarily.',
      'Mixing up which side is opposite versus adjacent for the chosen angle.',
    ],
  },
];
