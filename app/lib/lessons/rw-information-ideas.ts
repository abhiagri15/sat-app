import type { Lesson } from './types';

export const RW_INFORMATION_IDEAS_LESSONS: Lesson[] = [
  {
    skill: 'Central Ideas',
    tagline:
      'Tests whether you can pin down the single main point a short passage is built to make.',
    overview: [
      'A Central Ideas question gives you one short academic paragraph and asks for its main idea, central claim, or best summary. The four choices are all statements that sound like they could belong to the passage, but only one captures what the whole thing is actually about.',
      'The trap is that three wrong answers each latch onto a real detail from the text. Your job is not to find a true statement; it is to find the statement that the entire passage supports. Read for the point the author keeps returning to, not the first fact you recognize.',
    ],
    strategies: [
      {
        title: 'State the point in your own words first',
        body: 'Before looking at the choices, tell yourself in one plain sentence what the passage is mostly about. Then pick the choice closest to your sentence instead of letting the wording of the options lead you.',
      },
      {
        title: 'Find the sentence that everything else serves',
        body: 'Most passages have one claim, and the other sentences give examples, causes, or contrasts that support it. Identify that anchor sentence and treat the rest as evidence for it.',
      },
      {
        title: 'Test each choice for scope',
        body: 'A right answer covers the whole passage, not one line. Reject choices that are true but only describe a single detail, and reject choices that claim more than the passage actually says.',
      },
      {
        title: 'Watch for the pivot word',
        body: 'Words like "but," "however," and "yet" often mark where the author\'s real point begins. The main idea usually lives on the side of that pivot, not before it.',
      },
    ],
    workedExample: {
      passage:
        'For decades, biologists assumed that the elaborate songs of humpback whales served mainly to attract mates. Recent recordings from feeding grounds, however, complicate that view. Whales there produce structured song even when no potential mates are nearby, and the patterns shift as groups move between regions. Some researchers now argue that the songs also carry information about local conditions, functioning less like a courtship display and more like a shared, evolving dialect passed between populations.',
      prompt: 'Which choice best states the main idea of the passage?',
      choices: [
        'New evidence suggests humpback whale song may serve broader communicative purposes than the traditional mating explanation allows.',
        'Humpback whales produce their most elaborate songs when they are searching for a mate.',
        'Biologists have recorded humpback whale songs on feeding grounds for several decades.',
        'The songs of humpback whales change slightly as the animals travel between different regions.',
      ],
      correct:
        'New evidence suggests humpback whale song may serve broader communicative purposes than the traditional mating explanation allows.',
      walkthrough: [
        'The passage opens with the old assumption that song is for mating, then pivots on "however" to recordings that complicate it.',
        'The rest of the paragraph builds toward researchers arguing the songs carry information and act like a shared dialect, which is the point everything supports.',
        'The choice "New evidence suggests humpback whale song may serve broader communicative purposes than the traditional mating explanation allows" captures that whole arc of old view to revised view.',
        'The other three each restate a single detail: the mating claim the passage moves past, the fact of the recordings, or the regional shift, none of which is the overall point.',
      ],
    },
    traps: [
      'Choosing a statement that is true but only describes one detail rather than the whole passage.',
      'Picking the idea from the first sentence when a pivot word later overturns it.',
      'Selecting a choice that overstates the passage by turning a tentative claim into a certain one.',
    ],
  },
  {
    skill: 'Inferences',
    tagline:
      'Tests whether you can draw the one conclusion the passage logically forces, without adding outside assumptions.',
    overview: [
      'An Inferences question gives you a short passage and asks which choice most logically completes it or follows from it. Some versions present a passage that trails off and ask what conclusion it points to; others ask what can reasonably be concluded from the stated facts.',
      'A valid inference is not a guess and not a leap. It is a statement that must be true if the passage is true. Stay tightly tethered to the text: the correct answer is often modest and almost obvious once you connect the passage\'s own clues, while wrong answers sound impressive but reach past what the words support.',
    ],
    strategies: [
      {
        title: 'Lock onto the logical relationship',
        body: 'Notice how the sentences relate, such as cause and effect, comparison, or an unstated contrast. The inference usually completes that relationship rather than introducing a new one.',
      },
      {
        title: 'Predict before you read the choices',
        body: 'Finish the thought yourself in one sentence based only on the passage. A choice that matches your prediction is far likelier to be the answer than one that surprises you.',
      },
      {
        title: 'Demand that it "must be true"',
        body: 'Ask of each choice whether the passage guarantees it. If you can imagine the passage being true while the choice is false, eliminate it, no matter how plausible it sounds.',
      },
      {
        title: 'Reject outside knowledge',
        body: 'A tempting choice may be true in the real world but unsupported by this passage. The exam rewards only what the given text establishes, so ignore what you happen to know.',
      },
    ],
    workedExample: {
      passage:
        'Archaeologists studying a small coastal settlement found that its pottery was made from clay sourced more than two hundred kilometers inland. The settlement itself shows no evidence of clay deposits or pottery kilns. Yet finished ceramic vessels appear in nearly every household excavated at the site, and their styles closely match those produced at a large inland town known for its workshops.',
      prompt:
        'Which choice most logically completes the text with a conclusion supported by the passage?',
      choices: [
        'The coastal settlement likely obtained its pottery through trade or exchange with the inland town rather than producing it locally.',
        'The residents of the coastal settlement preferred inland pottery styles because their own were considered inferior.',
        'The inland town depended on the coastal settlement for most of its finished ceramic goods.',
        'The coastal settlement eventually developed its own kilns to reduce its reliance on distant sources.',
      ],
      correct:
        'The coastal settlement likely obtained its pottery through trade or exchange with the inland town rather than producing it locally.',
      walkthrough: [
        'The passage establishes that the coast had no clay and no kilns, yet was full of vessels matching an inland town\'s workshops.',
        'If the pottery could not have been made on-site but is everywhere and matches a distant source, it must have arrived from elsewhere.',
        'The choice "The coastal settlement likely obtained its pottery through trade or exchange with the inland town rather than producing it locally" is exactly what those clues force.',
        'The other choices add claims the text never supports, such as a preference for inland styles, a reversed dependence, or later kiln-building, so each reaches beyond the evidence.',
      ],
    },
    traps: [
      'Picking a choice that could be true but is not guaranteed by the passage.',
      'Reversing the direction of a relationship the passage describes.',
      'Filling gaps with real-world knowledge the passage itself never provides.',
    ],
  },
  {
    skill: 'Command of Evidence',
    tagline:
      'Tests whether you can identify the detail from a text that would most directly support or undermine a given claim.',
    overview: [
      'A Command of Evidence question presents a passage, often describing a hypothesis, argument, or finding, and asks which statement would most strongly support, illustrate, or weaken a specified claim. The answer choices are candidate pieces of evidence, and only one connects directly to the exact claim in question.',
      'The key is precision about what the claim actually asserts. Before weighing evidence, restate the claim narrowly, then ask which choice speaks to that claim and pushes it in the required direction. Evidence that is merely related to the topic but does not touch the specific claim is a distractor.',
    ],
    strategies: [
      {
        title: 'Nail down the exact claim',
        body: 'Underline in your mind what the prompt asks you to support or weaken. A choice that discusses the general subject but not that precise claim cannot be the answer.',
      },
      {
        title: 'Decide the direction you need',
        body: 'Confirm whether you are strengthening or weakening the claim before reading choices, so you do not pick a true statement that pushes the wrong way.',
      },
      {
        title: 'Match the evidence to the claim\'s terms',
        body: 'The best choice uses the same key variables the claim does. If the claim is about speed, evidence about cost is off-target no matter how factual it is.',
      },
      {
        title: 'Reject evidence that is too weak or too broad',
        body: 'Eliminate choices that only hint at the claim or that would be true regardless of whether the claim holds. Strong evidence changes how confident you are in the claim.',
      },
    ],
    workedExample: {
      passage:
        'A team of ecologists proposed that a native wildflower had declined in a meadow because an introduced beetle was eating its seeds before they could germinate. To evaluate this idea, the researchers wanted to know whether protecting seeds from the beetle would change how many new wildflowers appeared. They planned to compare germination in plots the beetles could reach with germination in plots from which the beetles were excluded.',
      prompt:
        'Which finding, if true, would most directly support the ecologists\' proposed explanation for the wildflower\'s decline?',
      choices: [
        'Plots from which the beetles were excluded produced far more new wildflowers than plots the beetles could reach.',
        'The introduced beetle was found in several other meadows across the same region.',
        'The wildflower\'s seeds germinate more slowly than the seeds of most nearby plant species.',
        'The meadow received less rainfall in the years following the beetle\'s arrival than it had before.',
      ],
      correct:
        'Plots from which the beetles were excluded produced far more new wildflowers than plots the beetles could reach.',
      walkthrough: [
        'The claim is specific: the beetle caused the decline by eating seeds before germination, and the test compares beetle-accessible plots with beetle-excluded plots.',
        'Support means showing that removing the beetle lets more wildflowers appear, which is exactly what the excluded plots should reveal.',
        'The choice "Plots from which the beetles were excluded produced far more new wildflowers than plots the beetles could reach" matches the claim\'s variables and the planned comparison directly.',
        'The others are off-target: the beetle\'s range elsewhere, the seeds\' natural speed, and a rainfall change each concern the topic but do not tie beetle removal to more germination, and the rainfall detail even offers a rival cause.',
      ],
    },
    traps: [
      'Choosing a fact about the general topic that never touches the specific claim.',
      'Selecting evidence that points in the opposite direction from what the prompt asks.',
      'Picking a statement so broadly true that it would hold whether or not the claim is correct.',
    ],
  },
  {
    skill: 'Command of Evidence (Quantitative)',
    tagline:
      'Tests whether you can read numbers from a described study or table and use them to back up or challenge a claim.',
    overview: [
      'A Command of Evidence (Quantitative) question describes data in words, such as a study or a table summarized with specific figures, and pairs it with a claim. Your task is to choose the finding that best supports, completes, or weakens that claim using the numbers given.',
      'Treat the numbers as the argument. Read the claim carefully, note which group or trend it is about, and then find the choice whose figures move that claim in the required direction. Wrong choices often cite real numbers from the data but attach them to the wrong comparison, so keep the specific groups the claim names firmly in view.',
    ],
    strategies: [
      {
        title: 'Anchor to the claim\'s comparison',
        body: 'Identify exactly which groups or time points the claim compares, then look only for numbers that speak to that comparison rather than any impressive figure.',
      },
      {
        title: 'Confirm the direction of the numbers',
        body: 'Check whether supporting the claim requires a higher, lower, or steady value, and verify the choice\'s figures actually move that way.',
      },
      {
        title: 'Use the exact figures, not a vague impression',
        body: 'Plug the specific numbers into the claim. A choice that rounds, reverses, or invents values that were not stated is a distractor even if it sounds close.',
      },
      {
        title: 'Reject accurate but irrelevant data',
        body: 'A choice can quote the data correctly and still be wrong if those particular numbers do not bear on the claim being tested. Relevance beats accuracy alone.',
      },
    ],
    workedExample: {
      passage:
        'A researcher studied whether a new after-school tutoring program improved reading scores. Students who enrolled in the program raised their average reading score from 62 to 78 over one semester, a gain of 16 points. A comparison group of similar students who did not enroll rose from 61 to 65 over the same period, a gain of 4 points. The researcher claimed that the tutoring program, rather than ordinary classroom instruction, was responsible for most of the improvement seen in the enrolled students.',
      prompt:
        'Which finding from the study best supports the researcher\'s claim?',
      choices: [
        'Enrolled students gained 16 points while the comparison group, receiving only ordinary instruction, gained just 4 points.',
        'Enrolled students reached a final average reading score of 78 by the end of the semester.',
        'The comparison group began the semester with an average reading score of 61.',
        'Both groups of students improved their average reading scores over the course of the semester.',
      ],
      correct:
        'Enrolled students gained 16 points while the comparison group, receiving only ordinary instruction, gained just 4 points.',
      walkthrough: [
        'The claim is that the tutoring, not ordinary instruction, caused most of the gain, so the useful evidence compares tutored students against the untutored comparison group.',
        'The comparison group shows what ordinary instruction alone produces, a 4-point rise, while the tutored group rose 16 points.',
        'The choice "Enrolled students gained 16 points while the comparison group, receiving only ordinary instruction, gained just 4 points" isolates the extra gain to the tutoring by contrasting the two groups directly.',
        'The other choices quote real numbers but drop the comparison: a single final score, one group\'s starting point, or the fact that both improved cannot show the program caused the difference.',
      ],
    },
    traps: [
      'Citing one group\'s final number without comparing it to the group that received no treatment.',
      'Noting that both groups improved, which alone cannot credit the program for the difference.',
      'Using a correctly quoted figure that does not address the specific comparison the claim makes.',
    ],
  },
];
