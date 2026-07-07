import type { Lesson } from './types';

export const RW_EXPRESSION_LESSONS: Lesson[] = [
  {
    skill: 'Rhetorical Synthesis',
    tagline:
      'Pick the sentence that uses the given notes to accomplish one specific rhetorical goal.',
    overview: [
      'Rhetorical Synthesis gives you a short set of bullet-point notes a student has gathered, then asks you to combine them into one sentence that meets a stated goal. The goal is the whole game: "emphasize a similarity," "introduce the topic to an unfamiliar audience," "explain a cause," and so on.',
      'This is not a grammar question, and it is not a main-idea question. All four choices are usually grammatical and factually accurate. Only one does the exact job the prompt names. Read the goal first, then hunt for the choice that performs it.',
    ],
    strategies: [
      {
        title: 'Read the goal before the notes',
        body: 'Underline the verb and object in the prompt — "emphasize the difference," "highlight the result," "introduce the study." That phrase is your filter for everything below.',
      },
      {
        title: 'Turn the goal into a test question',
        body: 'If the goal is to emphasize an effect, ask of each choice: does this show a change AND its result? A choice that states only one fact cannot emphasize a relationship.',
      },
      {
        title: 'Eliminate choices that are merely true',
        body: 'Every choice will be accurate. Cross out the ones that state a real fact but do not perform the goal — being correct is not the same as being responsive.',
      },
      {
        title: 'Use only what the notes give you',
        body: 'A tempting choice sometimes adds an idea the notes never mention. If a claim is not supported by a bullet, it is wrong no matter how good it sounds.',
      },
      {
        title: 'Match the number of ideas to the goal',
        body: 'Goals about comparison, cause, or effect need two linked facts. Goals about defining or introducing need one clear statement. Count the ideas the goal requires and check the choice supplies them.',
      },
    ],
    workedExample: {
      passage:
        'While researching a topic, a student has taken the following notes:\n' +
        '- Monarch butterflies migrate up to 3,000 miles each fall.\n' +
        '- They travel from Canada and the northern United States to central Mexico.\n' +
        '- No single butterfly makes the whole round trip.\n' +
        '- It takes three to four generations to complete one full migration cycle.',
      prompt:
        'The student wants to emphasize how the monarch migration is completed across multiple generations. Which choice most effectively uses relevant information from the notes to accomplish this goal?',
      choices: [
        'Monarch butterflies migrate up to 3,000 miles each fall, traveling from Canada to central Mexico.',
        'Because no single butterfly survives the entire journey, it takes three to four generations of monarchs to complete one full migration cycle.',
        'Monarch butterflies travel from Canada and the northern United States to central Mexico.',
        'Each fall, monarch butterflies begin a migration that covers up to 3,000 miles.',
      ],
      correct:
        'Because no single butterfly survives the entire journey, it takes three to four generations of monarchs to complete one full migration cycle.',
      walkthrough: [
        'The goal is to emphasize that the migration is finished across multiple generations, so the answer must link "no single butterfly makes the trip" to the multi-generation cycle.',
        'The sentence starting "Because no single butterfly survives the entire journey" joins those two notes into a cause-and-effect statement about generations — exactly the goal.',
        'The choices about the 3,000-mile distance and the Canada-to-Mexico route are true but say nothing about generations, so they miss the goal.',
        'Because only one choice performs the stated goal using the notes, it is the answer.',
      ],
    },
    traps: [
      'Choosing a sentence that is accurate but does not do the specific job the goal names.',
      'Picking the choice that packs in the most notes rather than the one that fits the goal.',
      'Selecting an answer that adds a claim not found in any bullet point.',
      'Answering the wrong goal because you skimmed the prompt before reading the notes.',
    ],
  },
  {
    skill: 'Transitions',
    tagline:
      'Choose the word or phrase that matches the logical relationship between the two ideas.',
    overview: [
      'A Transitions question puts a blank between two ideas and asks which connector belongs there. Your job is to name the relationship the sentences already have — contrast, cause and effect, addition, example, or sequence — and then pick the transition that signals it.',
      'The sentences do the arguing; the transition only labels the turn. So decide the logic from the content first, before you look at the choices. If the second idea reverses the first, you need a contrast word. If it results from the first, you need a cause word.',
    ],
    strategies: [
      {
        title: 'Cover the choices and predict',
        body: 'Read both sentences and say the relationship out loud in your own words — "but," "so," "also," "for example." Then find the choice that matches your prediction.',
      },
      {
        title: 'Sort transitions into families',
        body: 'Contrast: however, nevertheless, in contrast. Cause/effect: therefore, consequently, as a result. Addition: moreover, similarly, in addition. Example: for instance, for example. Sequence: first, then, finally.',
      },
      {
        title: 'Watch for a reversal',
        body: 'If the second sentence undercuts, limits, or surprises after the first, the answer is almost always a contrast word — do not let a smooth-sounding addition word fool you.',
      },
      {
        title: 'Test the answer by reading it in',
        body: 'Plug your pick into the blank and read the whole thing. If the connection suddenly feels wrong or redundant, the relationship was different than you thought.',
      },
    ],
    workedExample: {
      passage:
        'The company promised that its new packaging would be fully recyclable. ______ independent testing found that the material could only be processed at a handful of specialized facilities.',
      prompt: 'Which choice completes the text with the most logical transition?',
      choices: ['However,', 'For example,', 'As a result,', 'Similarly,'],
      correct: 'However,',
      walkthrough: [
        'The first sentence makes a promise: the packaging is fully recyclable.',
        'The second sentence undercuts that promise — testing showed it can barely be recycled, which is a reversal.',
        'A reversal calls for a contrast word, so "However," fits; "As a result," and "Similarly," imply agreement, and "For example," would introduce an instance of the promise.',
        'Reading "However," into the blank confirms the contrast reads smoothly, so it is the answer.',
      ],
    },
    traps: [
      'Reaching for a cause-and-effect word when the two ideas actually contrast.',
      'Choosing a transition that sounds sophisticated instead of the one the logic requires.',
      'Treating "for example" as correct when the second sentence is not an instance of the first.',
      'Deciding the relationship from the choices instead of from the sentences themselves.',
    ],
  },
];
