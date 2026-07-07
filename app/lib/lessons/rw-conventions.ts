import type { Lesson } from './types';

export const RW_CONVENTIONS_LESSONS: Lesson[] = [
  {
    skill: 'Boundaries (Modifiers)',
    tagline:
      'A describing phrase must sit next to the noun it actually describes — usually the very next word.',
    overview: [
      'Modifier questions test whether an opening phrase points to the right noun. When a sentence starts with a describing phrase and a comma, the SAT expects the word right after the comma to be the thing that phrase describes. If the wrong noun shows up there, the phrase "dangles" and the meaning breaks.',
      'Most of these items are completion questions: the phrase is fixed, and you pick the subject that logically performs or owns the action. Your job is to find the noun the phrase is really about and make sure your choice puts it in that lead slot.',
    ],
    strategies: [
      {
        title: 'Read the opening phrase, then ask "who?"',
        body: 'Turn the phrase into a question. "Walking into the lab" — who was walking? Whatever the answer is must be the first noun after the comma.',
      },
      {
        title: 'Check the word right after the comma',
        body: 'The SAT plants the trap by putting an object, a place, or an abstract idea in that slot instead of the doer. Confirm the noun there can actually do what the phrase describes.',
      },
      {
        title: 'Watch for -ing and -ed openers',
        body: 'Phrases beginning with words like "having," "designed," "hoping," or "known" are classic modifier setups. They demand a specific subject to attach to.',
      },
      {
        title: 'Rebuild the sentence in your head',
        body: 'Say "The phrase describes X, so X must come first." If your chosen subject makes the sentence literally true, keep it; if it creates a cartoon (a report that walks, a bridge that studies), reject it.',
      },
    ],
    workedExample: {
      passage:
        'Trained for years in the study of coral reefs, ______ documented the slow bleaching of the atoll with time-lapse cameras positioned along the reef wall.',
      prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
      choices: [
        'the atoll',
        'the cameras were used when the biologist',
        'the biologist',
        'it was the reef that',
      ],
      correct: 'the biologist',
      walkthrough: [
        'The opening phrase is "Trained for years in the study of coral reefs." Ask who was trained.',
        'A person can be trained — an atoll, cameras, and a reef cannot. So the subject must be a person.',
        'Only "the biologist" is a person who could be trained, so it belongs right after the comma.',
        'The other choices force the phrase to describe an object or place, creating a dangling modifier.',
      ],
    },
    traps: [
      'Choosing the noun that sounds important in the sentence instead of the one the opening phrase describes.',
      'Letting a plausible-sounding place or object slip into the subject slot after the comma.',
      'Ignoring that -ing and -ed openers still need a doer, not just any nearby noun.',
    ],
  },
  {
    skill: 'Boundaries (Punctuation)',
    tagline:
      'The right mark depends on whether each side of the gap could stand alone as a full sentence.',
    overview: [
      'Boundaries questions ask you to join or separate two parts of a sentence correctly. The whole decision turns on one test: is each side an independent clause (a complete sentence) or not? Once you know that, the legal marks fall out automatically.',
      'Two independent clauses can be linked by a period, a semicolon, or a comma plus a coordinating conjunction (and, but, or, so, yet). A colon or a dash can introduce an explanation or a list when the first part is complete. A comma alone between two full sentences is a comma splice — always wrong.',
    ],
    strategies: [
      {
        title: 'Split at the gap and test both sides',
        body: 'Cover everything before the blank, then everything after. Label each side "complete sentence" or "fragment." Your marks are decided by those two labels.',
      },
      {
        title: 'Two complete sentences? Use a strong boundary',
        body: 'A period, a semicolon, or a comma plus and/but/or/so/yet all work. A bare comma does not — that is a comma splice.',
      },
      {
        title: 'Reach for a colon only after a complete sentence',
        body: 'A colon needs a full independent clause on its left; it then introduces a list, an example, or an explanation. If the left side is a fragment, the colon is wrong.',
      },
      {
        title: 'Do not wall off a fragment',
        body: 'If one side cannot stand alone, you usually need a comma or no punctuation — never a period, semicolon, or colon that treats the fragment like a full sentence.',
      },
    ],
    workedExample: {
      passage:
        'The city planted thousands of oak saplings along the highway median______ within a decade the trees formed a continuous green canopy that cooled the road below.',
      prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
      choices: [';', ', within', ': the fact that', ' which'],
      correct: ';',
      walkthrough: [
        'Left of the gap: "The city planted thousands of oak saplings along the highway median" is a complete sentence.',
        'Right of the gap: "within a decade the trees formed a continuous green canopy that cooled the road below" is also a complete sentence.',
        'Two independent clauses need a strong boundary, so a semicolon works cleanly.',
        'The comma option makes a splice, the colon setup breaks the second clause, and " which" turns the second half into a fragment.',
      ],
    },
    traps: [
      'Joining two complete sentences with only a comma (a comma splice).',
      'Using a colon or dash when the part before it is not a complete sentence.',
      'Cutting off a fragment with a period or semicolon as if it were a full clause.',
    ],
  },
  {
    skill: 'Form & Structure (Verbs)',
    tagline:
      'Pick the verb tense and form that matches the sentence’s time frame and its other verbs.',
    overview: [
      'These questions test verb form: tense (past, present, future), aspect (simple, perfect, progressive), and consistency with the rest of the passage. The SAT gives you time cues — dates, sequence words, and neighboring verbs — and asks you to keep the timeline coherent.',
      'You are not asked what "sounds fancy." You are asked what fits. If everything around the blank is in past tense, a random present-tense verb clashes. If one action clearly happened before another, a perfect tense ("had finished") may be exactly right.',
    ],
    strategies: [
      {
        title: 'Find the time markers first',
        body: 'Scan for dates, "now," "by 1920," "currently," "since," or sequence words like "before" and "after." They lock in the era the verb must live in.',
      },
      {
        title: 'Match the surrounding verbs',
        body: 'Look at the other verbs in the sentence and paragraph. A consistent tense is usually correct; a lone tense change needs a real reason.',
      },
      {
        title: 'Use perfect tenses for order',
        body: 'When one past action finished before another past action, "had" + past participle shows that sequence. When something started in the past and continues, "has" + past participle fits.',
      },
      {
        title: 'Eliminate on clash, not on sound',
        body: 'Cross off any choice that fights a clear time cue. Do not keep an answer just because it feels smoother — fit beats flavor.',
      },
    ],
    workedExample: {
      passage:
        'By the time the museum opened its doors in 1932, the architect ______ every skylight to catch the low winter sun, a detail visitors still admire.',
      prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
      choices: ['had angled', 'angles', 'will angle', 'is angling'],
      correct: 'had angled',
      walkthrough: [
        'The cue "By the time the museum opened its doors in 1932" sets a point in the past.',
        'The angling of the skylights had to be finished before that opening.',
        'A past action completed before another past action calls for the past perfect: "had angled."',
        'Present, future, and progressive forms all clash with the 1932 time frame.',
      ],
    },
    traps: [
      'Switching to present tense in a passage that is clearly set in the past.',
      'Ignoring a sequence cue that requires a perfect tense to show one action came first.',
      'Choosing a verb form for its sound rather than for the timeline the sentence sets up.',
    ],
  },
  {
    skill: 'Subject-Verb Agreement',
    tagline:
      'A singular subject takes a singular verb, and a plural subject takes a plural verb — no matter what sits between them.',
    overview: [
      'Agreement questions test one match: subject to verb in number. The SAT hides the subject behind prepositional phrases, clauses, and lists so the noun nearest the verb tricks you. Find the true subject and ignore the clutter.',
      'The nouns inside "of the samples," "along with the crew," or "who studied the data" are decoys. They are never the subject of the verb you are choosing. Strip them away and the correct verb usually becomes obvious.',
    ],
    strategies: [
      {
        title: 'Cross out the middle',
        body: 'Bracket every phrase between the subject and the verb — "of the," "in the," "along with," "who/which/that" clauses. Read the subject straight into the verb.',
      },
      {
        title: 'Find the real subject',
        body: 'Ask what noun actually performs the verb. That head noun controls agreement, not the closest word or the object of a preposition.',
      },
      {
        title: 'Handle tricky subjects deliberately',
        body: 'Each, every, one, and either are singular. Collective nouns like team or committee are usually singular. Two nouns joined by "and" are plural.',
      },
      {
        title: 'Say it with the noun and verb alone',
        body: 'Test "the collection ... was" versus "the collection ... were." When you drop the decoys, the ear catches the mismatch fast.',
      },
    ],
    workedExample: {
      passage:
        'The archive of letters, diaries, and pressed flowers gathered by three generations of one family ______ now stored in a climate-controlled vault.',
      prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
      choices: ['is', 'are', 'were', 'have been'],
      correct: 'is',
      walkthrough: [
        'The subject is "The archive," which is singular.',
        'Everything from "of letters" through "one family" is a phrase describing the archive, not the subject.',
        'A singular subject needs a singular verb, so "is" agrees.',
        '"Are," "were," and "have been" are all plural and would agree only with a plural subject like "letters."',
      ],
    },
    traps: [
      'Matching the verb to the nearest noun instead of the true subject.',
      'Treating a collective noun like team or archive as plural.',
      'Forgetting that words like each, every, and one are singular even before a plural phrase.',
    ],
  },
  {
    skill: 'Pronoun Agreement',
    tagline:
      'A pronoun must match its noun in number and point clearly to one specific noun.',
    overview: [
      'Pronoun questions test two things: number agreement and clear reference. A singular noun needs a singular pronoun ("it," "its"); a plural noun needs a plural pronoun ("they," "their"). Just as important, the pronoun must have one obvious noun it stands for.',
      'The classic error is a number mismatch — a singular noun answered by a plural pronoun, or the reverse. Find the noun the pronoun replaces, check its number, and confirm no second noun could just as easily be the target.',
    ],
    strategies: [
      {
        title: 'Name the antecedent',
        body: 'Point to the exact noun the pronoun replaces. If you cannot name a single clear noun, the reference is broken and the pronoun is wrong.',
      },
      {
        title: 'Match the number',
        body: 'Singular noun, singular pronoun; plural noun, plural pronoun. A "company" is singular, so it takes "it," not "they."',
      },
      {
        title: 'Watch collective and indefinite nouns',
        body: 'Nouns like committee, team, and company are singular. Indefinites like each, everyone, and one are singular too, even when they feel like a crowd.',
      },
      {
        title: 'Reject ambiguous pronouns',
        body: 'If two nouns could both be what "it" or "they" points to, the sentence is unclear. The correct choice removes the confusion, sometimes by naming the noun outright.',
      },
    ],
    workedExample: {
      passage:
        'The research team spent two summers tagging migratory geese, and by the third year ______ had mapped a flyway that stretched across four countries.',
      prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
      choices: ['it', 'they', 'the geese', 'those'],
      correct: 'it',
      walkthrough: [
        'The pronoun must replace the noun that did the mapping: "The research team."',
        'A team is a collective noun, which is singular, so it takes the singular pronoun "it."',
        '"They" mismatches the singular subject, and "the geese" changes who did the mapping.',
        '"Those" has no clear singular noun to point to, leaving the reference broken.',
      ],
    },
    traps: [
      'Answering a singular collective noun like team or company with a plural pronoun.',
      'Using a pronoun that could point to either of two nouns in the sentence.',
      'Letting the closest noun, rather than the true antecedent, decide the pronoun.',
    ],
  },
];
