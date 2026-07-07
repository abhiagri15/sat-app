import type { Lesson } from './types';

export const RW_CRAFT_STRUCTURE_LESSONS: Lesson[] = [
  {
    skill: 'Words in Context',
    tagline:
      'Pick the word that fits the exact meaning the surrounding sentences build, not the word that merely sounds smart.',
    overview: [
      'This is a logic puzzle wearing a vocabulary costume. The passage gives you a blank and enough context to decide what the missing word has to mean; your job is to define the blank in your own words first, then find the choice that matches that definition.',
      'The four choices are common academic words the College Board reuses constantly (words like "undermine," "comprehensive," "tentative"), so they are all real words you probably know. The difficulty comes from choices that are close-but-off in tone, direction, or degree, not from obscure vocabulary.',
    ],
    strategies: [
      {
        title: 'Predict before you peek',
        body: 'Cover the choices and write your own word or short phrase in the blank based only on the passage. Then look for the choice that means the same thing.',
      },
      {
        title: 'Find the pivot word',
        body: 'Words like "however," "because," "although," and "instead" tell you whether the blank continues or reverses the surrounding idea. A "but" means your answer flips direction from the prior sentence.',
      },
      {
        title: 'Match direction, then degree',
        body: 'First confirm the choice points the right way (positive vs. negative, cause vs. effect). Then check its strength: "concerned" and "terrified" both mean worried, but only one fits a mild context.',
      },
      {
        title: 'Test each survivor in the sentence',
        body: 'Read the full sentence four times, once with each remaining choice. Eliminate any word that creates a claim the passage never supports, even if the word sounds sophisticated.',
      },
    ],
    workedExample: {
      passage:
        'Early reviewers dismissed the composer\'s final symphony as chaotic, arguing that its abrupt shifts in tempo betrayed a failure of craft. Later scholars, however, have come to see those same shifts as ______, the product of a deliberate design meant to unsettle the listener at precise moments.',
      prompt: 'Which choice completes the text with the most logical and precise word or phrase?',
      choices: ['accidental', 'intentional', 'conventional', 'melodic'],
      correct: 'intentional',
      walkthrough: [
        'The word "however" signals that the later scholars reverse the early reviewers\' verdict, so the blank must contrast with "a failure of craft."',
        'The phrase "the product of a deliberate design" defines the blank directly: the shifts were planned.',
        'The choice "intentional" matches "deliberate design" exactly, so the scholars now see the shifts as chosen on purpose.',
        'The choice "accidental" restates the reviewers\' complaint rather than contradicting it, and neither "conventional" nor "melodic" is supported by "unsettle the listener at precise moments."',
      ],
    },
    traps: [
      'Choosing the fanciest-sounding word instead of the one the passage actually defines.',
      'Ignoring a pivot word like "however," so you continue an idea the sentence meant to reverse.',
      'Picking a word that is the right topic but the wrong direction (positive where the context is negative).',
      'Settling for a word whose meaning is close but too strong or too weak for the situation described.',
    ],
  },
  {
    skill: 'Text Structure and Purpose',
    tagline:
      'Identify what a passage is doing as a whole, or what one specific sentence accomplishes for the argument around it.',
    overview: [
      'These questions ask about function, not just content. You are not summarizing what the passage says; you are describing the job a sentence or the overall structure performs, such as raising an objection, giving an example, or qualifying a claim.',
      'A reliable move is to read each sentence and mentally label its role: this one states a claim, this one gives evidence, this one anticipates a counterargument. Once you can name the moving parts, the answer describes the part the question points at.',
    ],
    strategies: [
      {
        title: 'Ask "why is this here," not "what does it say"',
        body: 'For a sentence-function question, restate the sentence\'s job in verb form: it introduces, it complicates, it illustrates, it concedes. Content is the trap; function is the answer.',
      },
      {
        title: 'Read the sentence in context, not alone',
        body: 'A sentence\'s function comes from what surrounds it. Read the sentence before and after so you can tell whether it sets up a point or pushes back against one.',
      },
      {
        title: 'Map the whole passage for structure questions',
        body: 'Track the shape: does it move from a general claim to specific support, from a problem to a solution, or from an old view to a revised one? The correct choice traces that same arc.',
      },
      {
        title: 'Prefer verbs that match the passage\'s moves',
        body: 'Answer choices are built from function verbs. Cross out any choice whose verb describes a move the passage never makes, such as "refutes" when nothing is actually rejected.',
      },
    ],
    workedExample: {
      passage:
        'For decades, conservationists assumed that reintroducing a top predator would automatically restore a damaged ecosystem. When wolves returned to one national park, elk populations did fall and streamside vegetation did recover. Yet the same strategy failed in several other regions, where prey simply relocated rather than declining. These mixed results suggest that predator reintroduction is a tool whose success depends heavily on local conditions, not a guaranteed remedy.',
      prompt:
        'Which choice best describes the function of the sentence "Yet the same strategy failed in several other regions, where prey simply relocated rather than declining" in the text as a whole?',
      choices: [
        'It provides a specific example that confirms the conservationists\' original assumption.',
        'It introduces a complication that challenges the idea that the strategy works everywhere.',
        'It proposes a new conservation method to replace predator reintroduction.',
        'It summarizes the passage\'s overall conclusion about local conditions.',
      ],
      correct:
        'It introduces a complication that challenges the idea that the strategy works everywhere.',
      walkthrough: [
        'The sentence opens with "Yet," which signals a turn against the successful wolf example that came right before it.',
        'By reporting a case where the strategy "failed," the sentence complicates the assumption that reintroduction "would automatically restore" an ecosystem.',
        'The choice "It introduces a complication that challenges the idea that the strategy works everywhere" names exactly that job of undercutting the automatic-success view.',
        'The passage never proposes a replacement method, so that choice fails, and the final sentence, not this one, states the conclusion about local conditions.',
      ],
    },
    traps: [
      'Summarizing what the sentence says instead of naming the role it plays in the argument.',
      'Reading the target sentence in isolation and missing the turn signaled by a word like "yet."',
      'Choosing a function the passage never performs, such as "refutes" or "proposes a solution."',
      'Confusing the passage\'s concluding sentence with a mid-passage sentence that only sets it up.',
    ],
  },
  {
    skill: 'Cross-Text Connections',
    tagline:
      'Figure out how two short texts on the same topic relate, or how one author would react to the other\'s specific claim.',
    overview: [
      'You get two brief texts by different authors on a shared subject, labeled Text 1 and Text 2. The question asks you to compare them: do they agree, disagree, extend, or qualify one another, and on exactly which point.',
      'Nail down each author\'s core claim before you compare. Then locate the precise spot where the texts touch the same idea, because the answer almost always hinges on that overlap, not on the topic in general. When the question asks how one author would respond, base the response only on views that author actually states.',
    ],
    strategies: [
      {
        title: 'Summarize each text in one sentence',
        body: 'Before comparing, write the main claim of Text 1 and the main claim of Text 2 in your own words. You cannot judge a relationship until you know both positions.',
      },
      {
        title: 'Locate the shared point of contact',
        body: 'The two texts discuss the same topic but may address different aspects of it. Find the exact claim they both speak to, since the relationship lives there.',
      },
      {
        title: 'Name the relationship as a verb',
        body: 'Decide whether Text 2 agrees with, disagrees with, qualifies, or adds evidence to Text 1. Pinning the relationship to one verb keeps you from a choice that overstates the conflict.',
      },
      {
        title: 'For response questions, stay inside the author\'s stated views',
        body: 'When asked how one author would react, use only what that author actually argues. A response the text does not support is wrong even if it sounds reasonable.',
      },
    ],
    workedExample: {
      passage:
        'Text 1\nStandardized test scores remain the fairest single measure available to college admissions offices. Because every applicant answers comparable questions under the same conditions, scores let a committee compare students from wildly different schools on common ground that grades alone cannot provide.\n\nText 2\nDefenders of standardized testing praise its uniformity, but that uniformity is exactly the problem. A single timed exam rewards students who can afford intensive coaching and penalizes those who cannot, so the "common ground" it appears to offer is tilted before the first question is read.',
      prompt:
        'How would the author of Text 2 most likely respond to the claim about fairness made in Text 1?',
      choices: [
        'By agreeing that test scores are the fairest measure but urging that grades be weighed alongside them.',
        'By arguing that the exam\'s uniform conditions do not produce genuine fairness because access to preparation is unequal.',
        'By conceding that coaching improves scores but denying that admissions offices rely on them.',
        'By claiming that grades are just as biased as test scores and should also be discarded.',
      ],
      correct:
        'By arguing that the exam\'s uniform conditions do not produce genuine fairness because access to preparation is unequal.',
      walkthrough: [
        'Text 1 rests its fairness claim on uniformity: every applicant "answers comparable questions under the same conditions."',
        'Text 2 targets that exact point, arguing the uniformity "is exactly the problem" because coaching gives wealthier students an edge.',
        'The choice "By arguing that the exam\'s uniform conditions do not produce genuine fairness because access to preparation is unequal" captures that the response attacks fairness through unequal preparation.',
        'The other choices fail because Text 2 never accepts that scores are fairest, never discusses admissions offices\' reliance, and never argues that grades should be discarded.',
      ],
    },
    traps: [
      'Comparing the topics in general instead of the exact claim both texts address.',
      'Overstating the relationship as flat disagreement when one text only qualifies the other.',
      'Inventing a response the author never actually supports because it sounds sensible.',
      'Mixing up which author holds which position and attributing Text 1\'s view to Text 2.',
    ],
  },
];
