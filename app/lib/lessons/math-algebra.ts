import type { Lesson } from './types';

export const MATH_ALGEBRA_LESSONS: Lesson[] = [
  {
    skill: 'Linear Equations',
    tagline: 'Isolate the variable by undoing operations in reverse order until x stands alone.',
    overview: [
      'A linear equation is any equation where the variable appears to the first power only — no x^2, no x in a denominator, no square roots. Your entire job is to get the variable by itself on one side. Whatever you do to one side, you do to the other, and you undo operations in the reverse of the order they were applied.',
      'On the Digital SAT, most Algebra questions live here, and many are pure setup: translate the words into an equation, then solve. The arithmetic is rarely the hard part — the trap is a sign error or forgetting to distribute. Work carefully and the points are reliable.',
    ],
    strategies: [
      {
        title: 'Clear grouping first',
        body: 'If there are parentheses, distribute before you do anything else. For 2(x - 4) = 10 you can either divide both sides by 2 first (x - 4 = 5) or distribute to 2x - 8 = 10 — both are valid, so pick whichever keeps the numbers clean.',
      },
      {
        title: 'Collect variables on one side',
        body: 'When x shows up on both sides, subtract the smaller x-term from both sides so you never carry a negative coefficient. From 5x + 3 = 2x + 18, subtract 2x to get 3x + 3 = 18.',
      },
      {
        title: 'Undo in reverse order',
        body: 'Peel off addition/subtraction before multiplication/division. If 4x - 3 = 9, add 3 first (4x = 12), then divide (x = 3). Doing it in the wrong order forces you to distribute a fraction.',
      },
      {
        title: 'Kill fractions early',
        body: 'If the equation has fractions, multiply every term by the common denominator to clear them before solving. For x/3 + 2 = 5, multiply through by 3 to get x + 6 = 15.',
      },
      {
        title: 'Check by back-substituting',
        body: 'Plug your answer into the original equation. If both sides match, you are done — this catches sign slips in seconds and is faster than re-solving.',
      },
    ],
    workedExample: {
      prompt:
        'If 5(x - 2) = 3x + 8, what is the value of x?',
      choices: ['3', '6', '9', '11'],
      correct: '9',
      walkthrough: [
        'Distribute the 5 on the left: 5x - 10 = 3x + 8.',
        'Subtract 3x from both sides to gather the variable: 2x - 10 = 8.',
        'Add 10 to both sides: 2x = 18.',
        'Divide by 2: x = 9. Check: 5(9 - 2) = 35 and 3(9) + 8 = 35 — both sides agree.',
      ],
    },
    traps: [
      'Distributing to only the first term inside the parentheses instead of every term.',
      'Flipping a sign when you move a term across the equals sign.',
      'Dividing before you have finished adding or subtracting, which turns clean numbers into fractions.',
    ],
  },
  {
    skill: 'Linear Functions',
    tagline: 'Read a linear function as a starting value plus a constant rate of change: f(x) = (rate)x + (start).',
    overview: [
      'A linear function models something that changes by the same amount for every one-unit step. In f(x) = mx + b, the b is the starting value (what you have at x = 0) and the m is the rate — how much f(x) goes up or down each time x increases by 1. Word problems almost always hand you these two pieces in plain English.',
      'The classic setup is "a flat fee plus a per-unit charge." The flat fee is b, the per-unit charge is m, and the quantity is your input. Once you can name which number is the rate and which is the constant, the equation writes itself.',
    ],
    strategies: [
      {
        title: 'Identify the constant vs. the rate',
        body: 'Ask what you have before anything happens (the constant b) and what changes per unit (the rate m). A $3 base fare is the constant and a $2-per-mile charge is the rate, so total cost C = 2d + 3 for d miles.',
      },
      {
        title: 'Match units to the variable',
        body: 'The rate multiplies whatever the variable counts. If the variable is miles, the number attached to it must be "per mile"; a per-hour rate attached to a miles variable is a wrong answer.',
      },
      {
        title: 'Use f(0) and f(1) to decode a definition',
        body: 'Given a function or a table, f(0) hands you b directly, and f(1) - f(0) hands you the rate. Two clean evaluations pin down the whole line.',
      },
      {
        title: 'Interpretation questions want words, not numbers',
        body: 'When a question asks what a coefficient "represents," translate it back into the story: the slope is the change per unit, the constant is the value at the start.',
      },
    ],
    workedExample: {
      passage:
        'A gym charges a one-time sign-up fee plus a fixed monthly rate. The total cost in dollars for a membership lasting m months is given by C(m) = 25m + 40.',
      prompt:
        'What does the number 40 represent in the function C(m) = 25m + 40?',
      choices: [
        'The monthly membership rate in dollars',
        'The one-time sign-up fee in dollars',
        'The total cost of a one-month membership',
        'The number of months in the membership',
      ],
      correct: 'The one-time sign-up fee in dollars',
      walkthrough: [
        'In C(m) = 25m + 40, the term 25m grows with the number of months, so 25 is the per-month rate.',
        'The 40 is the constant term — it does not depend on m, so it is charged once regardless of how long you stay.',
        'Evaluate at m = 0: C(0) = 40, the cost before any month has passed. That is the one-time sign-up fee.',
        'Note that the one-month total is C(1) = 65, not 40, which rules out the tempting "total cost of a one-month membership."',
      ],
    },
    traps: [
      'Swapping the roles of the rate and the constant when writing the equation.',
      'Assuming the constant b equals the value at x = 1 instead of the value at x = 0.',
      'Attaching a rate to the wrong quantity when the units do not match the variable.',
    ],
  },
  {
    skill: 'Systems of Equations',
    tagline: 'Two equations, two unknowns: eliminate a variable by adding, or substitute one equation into the other.',
    overview: [
      'A system asks for the values that make two equations true at the same time — graphically, the point where two lines cross. You have two tools: elimination (add or subtract the equations to cancel one variable) and substitution (solve one equation for a variable and plug it into the other). Choose whichever the equations set up more easily.',
      'Watch for questions that only ask for a combination like x + y, or for the number of solutions rather than the values themselves. The Desmos graphing calculator is a genuine shortcut here: type both equations and read the intersection point straight off the graph.',
    ],
    strategies: [
      {
        title: 'Add to eliminate when a variable is already paired',
        body: 'If the coefficients of one variable are opposites, add the equations to cancel it. From x + y = 10 and x - y = 4, adding gives 2x = 14, so x = 7 with no substitution needed.',
      },
      {
        title: 'Substitute when one variable is already alone',
        body: 'If one equation reads y = (something), plug that expression into the other equation so only one variable remains, then solve.',
      },
      {
        title: 'Scale first when nothing cancels',
        body: 'Multiply one or both equations by a constant so a pair of coefficients become opposites, then add. To cancel x from 2x + 3y = 12 and x + y = 5, multiply the second by -2 first.',
      },
      {
        title: 'Read what is actually asked',
        body: 'If the question wants x + y or 2x - y, you may be able to add or subtract the equations to get it directly, without ever finding x and y separately.',
      },
      {
        title: 'Graph it on Desmos as a check',
        body: 'Enter both equations and the intersection point is the solution. Parallel lines (no intersection) mean no solution; the same line means infinitely many.',
      },
    ],
    workedExample: {
      prompt:
        'The system 3x + 2y = 19 and x - 2y = 1 has solution (x, y). What is the value of x?',
      correct: '5',
      walkthrough: [
        'The y-terms are +2y and -2y — already opposites — so add the two equations to eliminate y.',
        'Adding left sides: 3x + 2y + x - 2y = 4x. Adding right sides: 19 + 1 = 20.',
        'So 4x = 20, which gives x = 5.',
        'Check by finding y: from x - 2y = 1, 5 - 2y = 1, so y = 2. Test in 3x + 2y: 3(5) + 2(2) = 19 — correct.',
      ],
    },
    traps: [
      'Adding the equations when a variable does not cancel, instead of scaling first so the coefficients become opposites.',
      'Solving for one variable and forgetting the question asked for the other (or for a combination).',
      'A sign error when subtracting equations — switch to adding a negated equation to stay safe.',
    ],
  },
  {
    skill: 'Inequalities',
    tagline: 'Solve inequalities like equations, but flip the sign whenever you multiply or divide by a negative.',
    overview: [
      'An inequality is solved with the same moves as an equation — add, subtract, multiply, divide to isolate the variable. The one rule that is different, and the one the SAT loves to test, is that multiplying or dividing both sides by a negative number reverses the direction of the inequality sign.',
      'Answers are ranges, not single values, so a common question format hands you a range and asks which value could (or could not) be a solution. When you are unsure of a boundary, test a number from each side of it — plugging in is faster and safer than re-deriving the sign.',
    ],
    strategies: [
      {
        title: 'Solve exactly like an equation',
        body: 'Use the same steps you would for an equals sign: isolate the variable term, then isolate the variable. For 4x - 3 < 9, add 3 to get 4x < 12, then divide by 4.',
      },
      {
        title: 'Flip the sign for a negative multiply or divide',
        body: 'Dividing or multiplying by a positive keeps the sign; by a negative it flips. From -2x > 6, divide by -2 and reverse: x < -3.',
      },
      {
        title: 'Test a value to confirm direction',
        body: 'After solving, pick a number that should work and plug it into the original inequality. If it makes the statement true, your direction is right; if not, you flipped when you should not have (or vice versa).',
      },
      {
        title: 'Handle compound inequalities in parallel',
        body: 'For a < expression < b, do the same operation to all three parts at once to keep the variable trapped in the middle.',
      },
    ],
    workedExample: {
      prompt:
        'Which of the following is the solution to the inequality 7 - 2x >= 1?',
      choices: ['x <= 3', 'x >= 3', 'x <= 4', 'x >= 4'],
      correct: 'x <= 3',
      walkthrough: [
        'Subtract 7 from both sides: -2x >= -6.',
        'Divide both sides by -2. Because you divided by a negative, reverse the inequality sign: x <= 3.',
        'Test x = 0 (which satisfies x <= 3): 7 - 2(0) = 7, and 7 >= 1 is true, so the direction is correct.',
        'Test x = 4 (which does not satisfy x <= 3): 7 - 2(4) = -1, and -1 >= 1 is false, confirming x <= 3.',
      ],
    },
    traps: [
      'Forgetting to reverse the inequality sign after dividing or multiplying by a negative number.',
      'Reversing the sign when you divided by a positive number — the flip rule applies only to negatives.',
      'Reporting a single value when the answer is an entire range of values.',
    ],
  },
  {
    skill: 'Slope & Lines',
    tagline: 'Slope is rise over run — the change in y divided by the change in x between two points.',
    overview: [
      'The slope of a line measures how steep it is: for every step to the right, how far up or down does the line go? Between two points it equals (y2 - y1) / (x2 - x1). A positive slope rises left to right, a negative slope falls, a horizontal line has slope 0, and a vertical line has an undefined slope.',
      'Slope-intercept form, y = mx + b, packs both key facts into one equation: m is the slope and b is the y-intercept (where the line crosses the y-axis). Parallel lines share the same slope; perpendicular lines have slopes that are negative reciprocals — their product is -1.',
    ],
    strategies: [
      {
        title: 'Subtract in a consistent order',
        body: 'Compute slope as (y2 - y1) / (x2 - x1), keeping the same point first in both the top and the bottom. For (1, 2) and (4, 11): (11 - 2) / (4 - 1) = 9/3 = 3.',
      },
      {
        title: 'Read slope straight off y = mx + b',
        body: 'Once an equation is solved for y, the coefficient of x is the slope and the lone constant is the y-intercept — no computation needed.',
      },
      {
        title: 'Rearrange standard form before reading slope',
        body: 'If a line is given as Ax + By = C, solve for y first. From 2x + 4y = 8 you get y = -(1/2)x + 2, so the slope is -1/2.',
      },
      {
        title: 'Use parallel and perpendicular relationships',
        body: 'Parallel lines have equal slopes; perpendicular slopes are negative reciprocals. A line perpendicular to one with slope 2 has slope -1/2.',
      },
    ],
    workedExample: {
      prompt:
        'A line passes through the points (2, -1) and (6, 7). What is the slope of the line?',
      correct: '2',
      walkthrough: [
        'Slope is the change in y over the change in x: (y2 - y1) / (x2 - x1).',
        'Using (2, -1) as point 1 and (6, 7) as point 2: the change in y is 7 - (-1) = 8.',
        'The change in x is 6 - 2 = 4.',
        'Slope = 8 / 4 = 2.',
      ],
    },
    traps: [
      'Computing run over rise (change in x over change in y) instead of rise over run.',
      'Mismatching the point order — subtracting y in one order but x in the other flips the sign.',
      'Reading the slope off Ax + By = C without first solving the equation for y.',
    ],
  },
];
