import type { Lesson } from './types';

export const MATH_PSDA_LESSONS: Lesson[] = [
  {
    skill: 'Percentages',
    tagline:
      'Turn every "percent of," percent-change, and reverse-percent question into a single multiplication by a decimal.',
    overview: [
      'Problem-Solving and Data Analysis leans hard on percentages, and the SAT rarely asks the easy version. Expect percent change, successive changes, and — the one that trips most students — working backwards from a final amount to the original. The good news is that almost every one of these collapses to a single move: multiply by a decimal multiplier.',
      'Translate the English directly. "Percent of" means multiply, an increase of p% means multiply by (1 + p/100), and a decrease of p% means multiply by (1 - p/100). Chaining changes just means multiplying the factors together. Reverse problems undo that multiplication with division. Once you see percentages as multipliers, the arithmetic is short enough to do without the calculator, though Desmos is handy for the messier decimals.',
    ],
    strategies: [
      {
        title: 'Convert the percent to a multiplier first',
        body: 'A 30% increase is ×1.30; a 30% decrease is ×0.70. Writing the multiplier before you touch any numbers removes the "add or subtract?" hesitation — you just multiply the starting value by it.',
      },
      {
        title: 'Multiply successive changes, never add them',
        body: 'A 20% increase followed by a 20% decrease is ×1.20 × 0.80 = ×0.96, a net 4% decrease — not 0%. Percent changes compound off different bases, so chain the multipliers instead of summing the percents.',
      },
      {
        title: 'For reverse problems, divide by the multiplier',
        body: 'If a value is 250 after a 25% increase, the original is 250 ÷ 1.25 = 200. Set (original) × (multiplier) = (final) and solve for the original by dividing. Never take the percent off the final number.',
      },
      {
        title: 'Read percent change as (new - old) / old',
        body: 'The denominator is always the original amount, not the new one. A jump from 40 to 50 is (50 - 40)/40 = 25%, but a drop from 50 to 40 is (40 - 50)/50 = -20%. Same gap, different base, different answer.',
      },
    ],
    workedExample: {
      prompt:
        'After a store increases the price of a coat by 25%, the new price is $250. What was the original price of the coat, in dollars?',
      correct: '200',
      walkthrough: [
        'A 25% increase means the original price was multiplied by 1 + 0.25 = 1.25 to reach the new price.',
        'So (original) × 1.25 = 250. This is a reverse-percent problem: divide the final amount by the multiplier rather than subtracting 25% of 250.',
        'Original = 250 ÷ 1.25 = 200. The original price was $200. Check: 200 × 1.25 = 250, which matches, so the SPR answer is 200.',
      ],
    },
    traps: [
      'Subtracting 25% of the final price ($250) instead of dividing — that gives $187.50 and is wrong because the 25% was taken on the original, not the new price.',
      'Adding two successive percent changes together (e.g. +20% then -20% as "no change") instead of multiplying the multipliers.',
      'Using the new value as the denominator in percent change; the base is always the original amount.',
    ],
  },
  {
    skill: 'Ratios & Proportions',
    tagline:
      'Set the given ratio equal to the unknown one and cross-multiply — but keep the units in the same order on both sides.',
    overview: [
      'Ratio and proportion problems give you a fixed relationship — a rate, a scale, a recipe — and ask you to scale it to a new quantity. The core skill is writing a proportion where the two fractions have matching units in matching positions, then cross-multiplying to solve.',
      'The most common failure is flipping one side. If the left fraction is miles over hours, the right fraction must also be miles over hours. When several quantities share one ratio, convert the ratio into parts: a 2 : 3 : 5 split of 100 has 2 + 3 + 5 = 10 parts, so each part is 10 and the pieces are 20, 30, and 50. Unit rates (per one) are the cleanest tool when a question mixes different totals.',
    ],
    strategies: [
      {
        title: 'Line up units before you cross-multiply',
        body: 'Write both fractions with the same quantity on top and the same quantity on bottom. If one side is dollars/pound, the other must be dollars/pound too. Matching units guarantees the cross-multiplication solves for the right thing.',
      },
      {
        title: 'Reduce a ratio to a unit rate when totals differ',
        body: 'Divide to get the "per one" value — miles per gallon, cost per item — then multiply by the new amount. Unit rates sidestep proportion setup entirely and are fast on Desmos.',
      },
      {
        title: 'Split a multi-part ratio using total parts',
        body: 'For a ratio like 3 : 4 : 5 applied to a total, add the terms (3 + 4 + 5 = 12) to get the number of parts, divide the total by that to find one part, then multiply back out for each share.',
      },
      {
        title: 'Watch what the question actually asks for',
        body: 'A problem may give the boys-to-girls ratio but ask for the fraction of the class that is girls, or for how many more boys than girls. Solve the proportion, then translate to the exact quantity requested.',
      },
    ],
    workedExample: {
      prompt:
        'A landscaping crew can lay 45 square feet of sod in 20 minutes, working at a constant rate. At this rate, how many minutes will it take the crew to lay 342 square feet of sod?',
      choices: ['76', '132', '152', '160'],
      correct: '152',
      walkthrough: [
        'Set up a proportion with square feet over minutes on both sides: 45/20 = 342/t, where t is the time for 342 square feet.',
        'Cross-multiply: 45t = 20 × 342 = 6840.',
        'Solve: t = 6840 ÷ 45 = 152 minutes. Check with a unit rate — the crew lays 45 ÷ 20 = 2.25 square feet per minute, and 342 ÷ 2.25 = 152 minutes, which matches.',
      ],
    },
    traps: [
      'Flipping one fraction (minutes over square feet on one side, square feet over minutes on the other), which solves for the reciprocal.',
      'Forgetting to add all terms of a multi-part ratio before dividing the total, so the "one part" value is wrong.',
      'Answering with a related quantity — the unit rate or the leftover amount — instead of the value the question asks for.',
    ],
  },
  {
    skill: 'Probability',
    tagline:
      'Count the favorable outcomes over the total outcomes — and read carefully whether the question restricts you to a subgroup.',
    overview: [
      'SAT probability is almost always the ratio of favorable outcomes to total outcomes, with the numbers coming from a described group or a two-way table. There is little counting theory here; the challenge is reading which set is the whole (the denominator) and which is the favorable part (the numerator).',
      'Conditional probability is the classic hard version: "given that the person is a senior, what is the probability they chose band?" restricts the denominator to just the seniors, not the whole school. Always ask "out of whom?" before you write the fraction. When a table is described in words, jot the numbers down and label the totals so you pull the right two figures.',
    ],
    strategies: [
      {
        title: 'Write probability as favorable over total',
        body: 'Identify the total number of equally likely outcomes for the denominator and the number that satisfy the condition for the numerator. Keep the fraction unreduced until the end so you can double-check the counts.',
      },
      {
        title: 'For "given that," shrink the denominator',
        body: 'A conditional probability restricts the whole group to the stated subgroup. "Given the student is a junior" means the denominator is the number of juniors, not the grand total. This single re-read fixes most missed probability questions.',
      },
      {
        title: 'Organize word-described tables into rows and columns',
        body: 'When the problem lists counts in prose, write them as a small grid with row and column totals. Pulling "the number of favorable" and "the correct total" from a labeled grid is far safer than tracking numbers in your head.',
      },
      {
        title: 'Match the answer form the question wants',
        body: 'Decide up front whether the answer should be a fraction, a decimal, or a percent, and whether it needs reducing. A probability of 8/40 and 0.2 and 20% are all correct forms of the same value — give the one requested.',
      },
    ],
    workedExample: {
      prompt:
        'A survey of 200 students recorded grade level and whether each student walks or bikes to school. Of the 200 students, 80 are juniors; 30 of those juniors bike, and the rest of the juniors walk. Given that a randomly selected student is a junior, what is the probability that the student walks to school?',
      choices: ['3/20', '1/4', '5/8', '3/8'],
      correct: '5/8',
      walkthrough: [
        'The phrase "given that a randomly selected student is a junior" restricts the denominator to the 80 juniors, not all 200 students.',
        'Of the 80 juniors, 30 bike, so the rest — 80 - 30 = 50 juniors — walk. The walkers are the favorable outcomes.',
        'Probability = 50/80 = 5/8. Using the full 200 as the denominator would give the trap value 50/200 = 1/4, so anchoring to the junior subgroup is what makes 5/8 correct.',
      ],
    },
    traps: [
      'Using the grand total as the denominator for a conditional ("given that ...") probability instead of the subgroup total.',
      'Counting the wrong category — for example, using the bikers when the question asks for walkers.',
      'Leaving the answer in an unrequested form (a percent when a reduced fraction is expected, or vice versa).',
    ],
  },
  {
    skill: 'Statistics (Mean)',
    tagline:
      'The mean is the total divided by the count, so recover the total first whenever a value is missing.',
    overview: [
      'Mean questions on the SAT rarely just ask you to average a short list. The productive versions hide a missing value, combine two groups, or change one data point and ask for the new mean. The unlock for nearly all of them is the sum: mean × count = total.',
      'When a value is unknown, write total = mean × count, subtract the known values, and what remains is the missing piece. When two groups combine, add their totals and divide by the combined count — you cannot average the two averages unless the groups are the same size. Keep a clear eye on the difference between mean (the balance point), median (the middle value), and mode (the most frequent), because the SAT mixes them to test whether you read the right measure.',
    ],
    strategies: [
      {
        title: 'Recover the total with mean times count',
        body: 'Turn every mean statement into a sum: if six numbers have a mean of 15, they total 6 × 15 = 90. From the total you can solve for a missing value or track how the sum shifts.',
      },
      {
        title: 'Combine groups by their sums, not their means',
        body: 'To merge two data sets, add their totals and divide by the total count. Averaging the two means only works when the groups have equal size; otherwise the larger group pulls the combined mean toward its own average.',
      },
      {
        title: 'For "add/remove a value," adjust the running total',
        body: 'Adding a new number changes the sum by that number and the count by one, then re-divide. This beats re-listing every value, especially for large data sets described in words.',
      },
      {
        title: 'Confirm you are asked for the mean and not the median',
        body: 'A skewed set — a few very large values — pulls the mean up while the median stays put. Reread which measure the question names before you compute, because the two often give different answers on purpose.',
      },
    ],
    workedExample: {
      prompt:
        'The average (arithmetic mean) of a set of 7 numbers is 18. When one additional number is included, the average of the 8 numbers becomes 20. What is the value of the number that was added?',
      correct: '34',
      walkthrough: [
        'The original 7 numbers have a total of 7 × 18 = 126, since mean × count = total.',
        'After adding one number, the 8 numbers have a total of 8 × 20 = 160.',
        'The added number is the difference between the two totals: 160 - 126 = 34. Check: (126 + 34)/8 = 160/8 = 20, which matches, so the SPR answer is 34.',
      ],
    },
    traps: [
      'Averaging two group means directly when the groups are different sizes, instead of combining their totals.',
      'Forgetting to update the count when a value is added or removed, so the final division uses the wrong denominator.',
      'Computing the mean when the question actually asks for the median or mode (or the reverse).',
    ],
  },
  {
    skill: 'Statistics (Spread)',
    tagline:
      'Spread is about how stretched or clustered the data is — compare ranges and standard deviations by how far values sit from the center.',
    overview: [
      'Spread questions test whether you understand variability: range, standard deviation, and how outliers move each measure. The SAT almost never makes you compute a standard deviation by hand. Instead it shows two data sets and asks which has the greater spread, or how a specific change affects the range or standard deviation.',
      'The mental model: standard deviation measures the typical distance of values from the mean, so a set whose values cluster tightly around the center has a small standard deviation, and a set with values spread far out has a large one. Range is just the maximum minus the minimum, so it is driven entirely by the two extreme values and is very sensitive to a single outlier. Reasoning about "how far from the middle" beats memorizing formulas here.',
    ],
    strategies: [
      {
        title: 'Judge standard deviation by clustering around the mean',
        body: 'More clustered around the center means a smaller standard deviation; more spread out means a larger one. To compare two sets, picture how far a typical value sits from the middle — you rarely need to calculate anything.',
      },
      {
        title: 'Compute range as max minus min',
        body: 'The range depends only on the two extreme values. Changing an interior value never changes the range, but adding a new maximum or minimum does. This makes range fast but fragile to outliers.',
      },
      {
        title: 'Track how an added value shifts spread',
        body: 'A value near the mean barely changes the standard deviation; a value far from the mean increases it. A new extreme increases the range; a value between the current extremes leaves the range untouched.',
      },
      {
        title: 'Separate spread from center',
        body: 'Two sets can have the same mean but very different spreads, or the same spread shifted to different means. Do not let a difference in averages fool you into thinking the variability differs — check the distances from each set’s own center.',
      },
    ],
    workedExample: {
      prompt:
        'Data set A consists of the values 48, 49, 50, 51, and 52. Data set B consists of the values 10, 30, 50, 70, and 90. Both data sets have a mean of 50. Which statement correctly compares the standard deviations of the two data sets?',
      choices: [
        'Data set A has the greater standard deviation.',
        'Data set B has the greater standard deviation.',
        'The two standard deviations are equal.',
        'The standard deviations cannot be compared without more information.',
      ],
      correct: 'Data set B has the greater standard deviation.',
      walkthrough: [
        'Both sets share a mean of 50, so compare how far the values sit from 50. Standard deviation measures that typical distance from the mean.',
        'In set A the values are within 2 of the mean (48 to 52), so they cluster tightly. In set B the values run from 10 to 90, so they sit as far as 40 from the mean.',
        'Because set B’s values are spread much farther from the shared center, set B has the greater standard deviation. Equal means do not imply equal spread, which rules out the "equal" choice.',
      ],
    },
    traps: [
      'Assuming that equal means imply equal spread — the center and the variability are independent.',
      'Thinking a change to an interior value alters the range; only a new maximum or minimum does.',
      'Believing an added data point always increases the standard deviation — a value right at the mean can leave it essentially unchanged or even lower it.',
    ],
  },
  {
    skill: 'Scatterplots & Models',
    tagline:
      'Read the line or curve of best fit as a model, then plug in, interpolate, or interpret its slope and intercept in context.',
    overview: [
      'Scatterplot questions give you a cloud of data points with a line or curve of best fit drawn through them, and ask you to use that model. The three recurring tasks are predicting a value (plug an input into the model), reading the slope and intercept in real-world terms, and judging how well a linear or exponential model fits.',
      'Slope is the rate of change — the amount the modeled quantity changes per one-unit increase in the input — and the y-intercept is the model’s predicted value when the input is zero. When a question asks you to predict, distinguish interpolation (inside the data range, reliable) from extrapolation (outside it, riskier). A linear model fits when the points rise or fall at a roughly constant rate; an exponential model fits when they change by a roughly constant percent, curving as they go.',
    ],
    strategies: [
      {
        title: 'Interpret slope as "per one unit"',
        body: 'The slope of a line of best fit is how much the output changes for each one-unit increase in the input, in the problem’s actual units — dollars per year, degrees per hour. State it with those units to lock in the meaning.',
      },
      {
        title: 'Read the y-intercept as the starting value',
        body: 'The y-intercept is the model’s predicted output when the input is zero — the initial amount, the baseline fee. Confirm that an input of zero makes sense in context before you lean on it.',
      },
      {
        title: 'Predict by substituting into the model equation',
        body: 'To estimate an output for a given input, plug the input into the best-fit equation and compute. Note whether the input is inside the data range (interpolation, trustworthy) or beyond it (extrapolation, less reliable).',
      },
      {
        title: 'Choose linear vs. exponential by the pattern of change',
        body: 'Constant additive change (same amount each step) signals a linear model; constant percent change (same factor each step, a curving trend) signals an exponential model. Match the model type to how the described points actually grow.',
      },
    ],
    workedExample: {
      prompt:
        'A researcher models the relationship between the number of weeks, w, a plant has been growing and its height, h, in centimeters, using the line of best fit h = 1.5w + 4. Based on this model, what is the best interpretation of the number 1.5?',
      choices: [
        'The predicted height of the plant, in centimeters, when it is first planted.',
        'The predicted increase in the plant’s height, in centimeters, for each additional week of growth.',
        'The number of weeks it takes the plant to grow 1 centimeter.',
        'The total height of the plant, in centimeters, after 4 weeks.',
      ],
      correct: 'The predicted increase in the plant’s height, in centimeters, for each additional week of growth.',
      walkthrough: [
        'In the model h = 1.5w + 4, the coefficient 1.5 multiplies w, so it is the slope — the rate of change of height with respect to weeks.',
        'Slope means "change in output per one-unit change in input," so 1.5 is the centimeters of height gained for each additional week.',
        'The constant 4 is the intercept (the height at week 0, when first planted), which rules out reading 1.5 as a starting height; 1.5 is the per-week growth rate.',
      ],
    },
    traps: [
      'Swapping the slope and the y-intercept — reading the intercept as a rate or the slope as a starting value.',
      'Extrapolating far beyond the data range and trusting the prediction as if it were interpolation.',
      'Picking a linear model for data that changes by a constant percent (which is exponential) or vice versa.',
    ],
  },
];
