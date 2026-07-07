import type { Lesson } from './types';

export const MATH_ADVANCED_LESSONS: Lesson[] = [
  {
    skill: 'Quadratics',
    tagline:
      'Read a quadratic from whatever form it arrives in — standard, factored, or vertex — and pull the exact fact the question asks for.',
    overview: [
      'Advanced Math quadratics questions rarely just say "solve." They ask for the sum of the solutions, the vertex, the number of real roots, or the value of a coefficient that makes two forms match. The fast solvers are the ones who recognize which of the three forms — standard (ax^2 + bx + c), factored (a(x - r)(x - s)), or vertex (a(x - h)^2 + k) — already contains the answer, and convert only when they must.',
      'Keep three facts on instant recall. For ax^2 + bx + c = 0, the sum of the solutions is -b/a and the product is c/a — you often never need the individual roots. The vertex x-coordinate is -b/(2a). And the discriminant b^2 - 4ac tells you the root count: positive means two real solutions, zero means one, negative means none. On Digital SAT Math you can also just graph it in Desmos and read the roots, vertex, or intersection points straight off the curve.',
    ],
    strategies: [
      {
        title: 'Match the form to the question',
        body: 'Want the vertex? Push toward vertex form or use -b/(2a). Want the roots? Factor or use the quadratic formula. Want how many solutions? Compute the discriminant b^2 - 4ac and stop — you do not need the roots themselves.',
      },
      {
        title: 'Use sum and product before you factor',
        body: 'For x^2 + bx + c = 0 the two roots add to -b and multiply to c. If a question asks only for the sum or product of the solutions, that is one arithmetic step — do not solve for each root.',
      },
      {
        title: 'Let the discriminant answer "how many"',
        body: 'A question about the number of real solutions, or an unknown that makes exactly one solution, is a discriminant question. Set b^2 - 4ac equal to (or greater/less than) zero and solve for the unknown.',
      },
      {
        title: 'Graph it in Desmos to confirm',
        body: 'Type the equation into the Desmos graphing calculator and click the curve: it labels the x-intercepts (roots), the vertex (min or max), and any intersection with a second equation. Use it to check the answer you found algebraically.',
      },
    ],
    workedExample: {
      prompt:
        'The equation x^2 - 10x + 18 = 0 has two solutions. What is the sum of those two solutions?',
      choices: ['-10', '5', '10', '18'],
      correct: '10',
      walkthrough: [
        'For a quadratic in the form x^2 + bx + c = 0, the sum of the solutions equals -b, where b is the coefficient of x.',
        'Here b = -10, so the sum of the solutions is -(-10) = 10. (The product would be c = 18, but the question only asks for the sum.)',
        'Check by the quadratic formula: the solutions are (10 ± sqrt(100 - 72))/2 = (10 ± sqrt(28))/2, which add to 10 because the ± sqrt terms cancel.',
      ],
    },
    traps: [
      'Reading -b as -10 instead of +10: the coefficient is -10, so -b = +10. Watch the sign flip.',
      'Solving for both roots when the question only wants their sum or product — that is wasted time and a chance to slip.',
      'Confusing the vertex x-coordinate -b/(2a) with the sum of the roots -b/a; they differ by a factor of 2.',
      'Forgetting that a negative discriminant means no real solutions, not two — always check the sign before you count.',
    ],
  },
  {
    skill: 'Exponents',
    tagline:
      'Rewrite both sides with the same base, then set the exponents equal — most exponent questions collapse to a one-line linear equation.',
    overview: [
      'Exponent questions test the laws of exponents and one big idea: if two powers of the same base are equal, their exponents are equal. So the winning move is almost always to force both sides of an equation onto a common base — turn 9 into 3^2, turn 1/8 into 2^(-3), turn sqrt(x) into x^(1/2) — and then work with the exponents directly.',
      'Have the rules ready to fire: multiply powers, add exponents (x^a · x^b = x^(a+b)); divide, subtract (x^a / x^b = x^(a-b)); a power of a power, multiply ((x^a)^b = x^(ab)); a negative exponent flips (x^(-a) = 1/x^a); and a fractional exponent is a root (x^(1/n) = the n-th root of x). Sign errors on subtraction and dropped negative exponents are the most common way these go wrong, so write each step out.',
    ],
    strategies: [
      {
        title: 'Force a common base',
        body: 'Rewrite every term as a power of the smallest base you can — 4, 8, 16, 32 all become powers of 2; 9, 27, 81 become powers of 3. Once both sides share a base, the exponents alone carry the equation.',
      },
      {
        title: 'Set exponents equal',
        body: 'If b^(expression1) = b^(expression2) with the same base b, then expression1 = expression2. That turns an exponential equation into an ordinary linear (or quadratic) equation you already know how to solve.',
      },
      {
        title: 'Combine before you compare',
        body: 'Collapse products and quotients on each side first using add/subtract-the-exponents, so each side is a single power. A tidy b^k = b^m is much harder to misread than a chain of factors.',
      },
      {
        title: 'Translate negatives and roots up front',
        body: 'Convert 1/b^n to b^(-n) and the n-th root to the (1/n) power before doing anything else. Handling them as exponents from the start prevents the classic dropped-negative and lost-root mistakes.',
      },
    ],
    workedExample: {
      prompt:
        'If 3^(2x) = 3^(x + 5), what is the value of x?',
      correct: '5',
      walkthrough: [
        'Both sides are already powers of the same base, 3, so their exponents must be equal.',
        'Set the exponents equal: 2x = x + 5.',
        'Subtract x from both sides: x = 5.',
        'Check: 3^(2·5) = 3^10 and 3^(5 + 5) = 3^10, so both sides match.',
      ],
    },
    traps: [
      'Comparing exponents when the bases are not yet the same — rewrite to a common base first or the shortcut is invalid.',
      'Subtracting exponents in the wrong order in a quotient: x^a / x^b is x^(a - b), not x^(b - a).',
      'Dropping the negative when converting 1/x^n to x^(-n), which flips the sign of the whole exponent.',
      'Treating a fractional exponent like a coefficient instead of a root — x^(1/2) is sqrt(x), not (1/2)x.',
    ],
  },
  {
    skill: 'Exponential Growth',
    tagline:
      'Model repeated percent change with a·b^t, where b = 1 + rate for growth and 1 - rate for decay — then read the starting value and multiplier straight from the words.',
    overview: [
      'Exponential growth and decay questions describe a quantity that changes by the same percent each period: a population up 8% a year, a balance earning 3% interest, a drug decaying 15% an hour. The model is always y = a·b^t. The starting amount a is the value when t = 0. The base b is the per-period multiplier: 1 + r for growth (8% growth gives b = 1.08) and 1 - r for decay (15% decay gives b = 0.85).',
      'The trap the SAT sets over and over is confusing exponential change with linear change. Linear adds a fixed amount each step (y = a + mt); exponential multiplies by a fixed factor each step (y = a·b^t). "Increases by 20 each year" is linear; "increases by 20% each year" is exponential. Match the model to the wording before you compute, and watch the units of t — if the rate is monthly but the question asks about years, your exponent has to count the right number of periods.',
    ],
    strategies: [
      {
        title: 'Identify a, then b',
        body: 'Pin the initial value a (the amount at t = 0), then build the multiplier b. Growth by r percent means b = 1 + r/100; decay by r percent means b = 1 - r/100. Assemble y = a·b^t.',
      },
      {
        title: 'Percent means multiply, not add',
        body: 'If a problem says "by X percent" each period, it is exponential — use b^t. If it says "by X units" each period, it is linear — use a + mt. Deciding this first prevents the single most common miss in this skill.',
      },
      {
        title: 'Make the exponent count real periods',
        body: 'The exponent is the number of compounding periods, not just the number in the problem. A 2% monthly rate over one year uses b^12, not b^1. Align the period of the rate with the period of t.',
      },
      {
        title: 'Read the multiplier back out of an answer',
        body: 'Given an equation, the base tells you the rate: b = 1.05 is 5% growth; b = 0.92 is 8% decay. Reverse this to check whether an answer choice describes the same scenario as the equation.',
      },
    ],
    workedExample: {
      prompt:
        'A biologist observes that a bacteria colony starts with 500 cells and increases by 20% every hour. Which equation gives the number of cells, y, after t hours?',
      choices: [
        'y = 500 + 20t',
        'y = 500(0.20)^t',
        'y = 500(1.20)^t',
        'y = 500(20)^t',
      ],
      correct: 'y = 500(1.20)^t',
      walkthrough: [
        'The colony starts at 500 cells, so the initial value a is 500 — that rules out any equation not built on 500 as the leading amount.',
        'It increases by 20% each hour, which is repeated percent change, so the model is exponential: y = a·b^t, not the linear y = 500 + 20t.',
        'A 20% increase makes the per-hour multiplier b = 1 + 0.20 = 1.20 (using 0.20 alone would shrink the colony, and using 20 would multiply it twentyfold each hour).',
        'So the equation is y = 500(1.20)^t.',
      ],
    },
    traps: [
      'Picking the linear model y = a + rt when the problem says "percent" — percent change is multiplicative, so it must be exponential.',
      'Using the bare rate 0.20 as the base instead of 1 + 0.20 = 1.20, which models a colony that collapses rather than grows.',
      'Forgetting to subtract for decay: a 15% decrease is a base of 0.85, not 1.15 and not 0.15.',
      'Leaving the exponent as t when the rate and the time are measured in different periods (monthly rate, yearly question).',
    ],
  },
  {
    skill: 'Equivalent Expressions',
    tagline:
      'Prove two expressions are the same by expanding, factoring, or combining — or just test a number in both when the algebra gets heavy.',
    overview: [
      'Equivalent Expressions questions ask you to rewrite a polynomial or rational expression in a different but equal form: expand a product, factor a quadratic, combine fractions over a common denominator, or split one expression into a quotient plus a remainder. The stated goal is usually to match the given expression to an answer choice or to a target form with blanks (like "in the form x + a/(x - b)").',
      'Two tools cover almost everything. Algebraically: FOIL and distribute to expand, and reverse it to factor, always tracking every sign. When the algebra is dense or you are unsure, use the plug-in method — pick a simple number for the variable (2 or 3 usually, avoiding values that make a denominator zero), evaluate the original expression, then evaluate each candidate; the equivalent one gives the same number. Equivalent expressions must agree for every legal input, so a single well-chosen test number is strong evidence and a fast tiebreaker.',
    ],
    strategies: [
      {
        title: 'Expand carefully with FOIL and distribution',
        body: 'To multiply out, distribute every term across every term and combine like terms. A dropped middle term or a sign error on a negative factor is what separates the right expansion from a close-looking wrong one.',
      },
      {
        title: 'Factor by reversing the pattern',
        body: 'For x^2 + bx + c, find two numbers that multiply to c and add to b. Recognize the special forms too: a difference of squares a^2 - b^2 = (a + b)(a - b), and a perfect square a^2 ± 2ab + b^2 = (a ± b)^2.',
      },
      {
        title: 'Combine fractions over a common denominator',
        body: 'To add or subtract rational expressions, rewrite each over the shared denominator, combine the numerators, then simplify. Match the resulting single fraction to the target form.',
      },
      {
        title: 'Plug in a number to test equivalence',
        body: 'When expanding fully is slow or risky, substitute a simple value for the variable into the original and into each choice. The choice that returns the same value is equivalent; if two tie, test a second number to break it.',
      },
    ],
    workedExample: {
      prompt:
        'Which expression is equivalent to (2x - 3)(x + 4)?',
      choices: [
        '2x^2 + 5x - 12',
        '2x^2 - 5x - 12',
        '2x^2 + 5x + 12',
        '2x^2 + 11x - 12',
      ],
      correct: '2x^2 + 5x - 12',
      walkthrough: [
        'Multiply the first terms: 2x · x = 2x^2.',
        'Multiply the outer and inner terms and add them: 2x · 4 = 8x and (-3) · x = -3x, giving 8x - 3x = 5x.',
        'Multiply the last terms: (-3) · 4 = -12.',
        'Combine: 2x^2 + 5x - 12. As a check, substitute x = 1: the original is (2 - 3)(1 + 4) = (-1)(5) = -5, and 2 + 5 - 12 = -5, so they agree.',
      ],
    },
    traps: [
      'Losing the middle term by only multiplying the first and last terms — you must also add the outer and inner products.',
      'Mishandling a negative factor: (-3)(x + 4) contributes -3x and -12, not +3x or +12.',
      'Stopping at the un-combined form 8x - 3x instead of simplifying it to 5x.',
      'Testing a plug-in value that makes a denominator zero (or picking x = 0 or x = 1, which can hide a difference between two choices).',
    ],
  },
  {
    skill: 'Functions',
    tagline:
      'Function notation is just a rule with an input slot — substitute what is inside the parentheses everywhere the variable appears, working inside-out for compositions.',
    overview: [
      'Functions questions test whether you can read and use notation like f(x), evaluate a function at a number or an expression, compose two functions, or work backward from an output to an input. The core skill is substitution: f(3) means replace every x in the rule for f with 3; f(a + 1) means replace every x with the whole expression a + 1, parentheses included.',
      'Composition f(g(x)) means "do g first, then feed its output into f." Always work from the inside out: compute g(x), then substitute that result into f wherever x appears. Two things trip students up — reading g(f(x)) as if it were f(g(x)) (order matters, they are usually different), and forgetting the parentheses when substituting an expression, which drops a sign or a term. On a graph, f(a) is the y-value at x = a; solving f(x) = c means finding the x-value(s) where the curve hits height c.',
    ],
    strategies: [
      {
        title: 'Substitute the whole input',
        body: 'Wherever the variable appears in the rule, drop in exactly what is inside the parentheses — a number, a variable, or a full expression — and wrap expressions in parentheses so signs and squares survive.',
      },
      {
        title: 'Compose from the inside out',
        body: 'For f(g(x)), evaluate the inner function g(x) first, then plug that entire result into f. Never combine the two rules in one step from memory; the intermediate value keeps you honest.',
      },
      {
        title: 'Mind the order of composition',
        body: 'f(g(x)) and g(f(x)) are generally different functions. Identify which is on the outside (the one whose parentheses hold everything) and evaluate the inner one first.',
      },
      {
        title: 'Read values off a graph or table',
        body: 'f(a) is the output paired with input a — the y at x = a on a graph, or the matching entry in a table. To solve f(x) = c, find every input whose output is c (every x where the graph is at height c).',
      },
    ],
    workedExample: {
      prompt:
        'The functions are defined by f(x) = 2x + 1 and g(x) = x^2 - 3. What is the value of f(g(2))?',
      choices: ['3', '5', '9', '11'],
      correct: '3',
      walkthrough: [
        'Work inside-out: evaluate the inner function g at 2 first. g(2) = 2^2 - 3 = 4 - 3 = 1.',
        'Now feed that result into f: f(g(2)) = f(1).',
        'Evaluate f at 1: f(1) = 2(1) + 1 = 3.',
        'So f(g(2)) = 3. (Note that g(f(2)) would be different: f(2) = 5, then g(5) = 22 — order matters.)',
      ],
    },
    traps: [
      'Reversing the order and computing g(f(2)) instead of f(g(2)) — the outer function is the one whose parentheses enclose everything.',
      'Substituting into the outer function first instead of evaluating the inner one — always resolve the inside to a number before moving out.',
      'Dropping parentheses when the input is an expression, so f(a + 1) loses a term or a sign.',
      'Misreading f(x) = c (find the input) as f(c) (evaluate at c) on graph and table questions.',
    ],
  },
];
