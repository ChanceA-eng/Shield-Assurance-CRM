export interface BlueprintQuizOption {
  text: string;
  explanation: string;
}

export interface CourseBlueprint {
  title: string;
  description: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  modules: Array<{
    title: string;
    lessons: Array<{
      title: string;
      contentType: 'TEXT' | 'INTERACTIVE' | 'PDF' | 'VIDEO';
      body: string;
      quizzes: Array<{
        question: string;
        options: BlueprintQuizOption[];
        answer: number;
      }>;
      blocks: Array<{
        type: 'TEXT' | 'CODE' | 'EXERCISE' | 'SIMULATION' | 'PDF' | 'VIDEO' | 'QUIZ';
        title: string;
        content: {
          body?: string;
          url?: string;
        };
      }>;
    }>;
  }>;
}

export const CONTRACTOR_MASTER_COURSE_TITLE = 'Contractor Liability and Risk Master Course';

const trueFalseOptions = (trueExplanation: string, falseExplanation: string): BlueprintQuizOption[] => [
  { text: 'True', explanation: trueExplanation },
  { text: 'False', explanation: falseExplanation },
];

export const contractorMasterCourseBlueprint: CourseBlueprint = {
  title: CONTRACTOR_MASTER_COURSE_TITLE,
  description:
    'Elite commercial P&C training for contractor risk specialists: legal framework, CGL mechanics, E&O timing, workers comp statutory execution, and claim-file practicals.',
  level: 'ADVANCED',
  modules: [
    {
      title: 'Module 1 - Foundations of Contractor Liability',
      lessons: [
        {
          title: 'Lesson 1.1 - Tripartite Legal Framework and Arizona ELR',
          contentType: 'INTERACTIVE',
          body: `{
  "schema": "lesson-experience-v1",
  "meta": {
    "title": "The Tripartite Legal Framework & The Arizona Economic Loss Rule",
    "readingTimeMinutes": 12,
    "difficulty": "Advanced"
  },
  "introduction": "Module 1 establishes the bedrock of your technical expertise. Before you can structure a policy, you must understand the exact legal origin of a loss across three separate legal systems.",
  "learningObjectives": [
    "Deconstruct any construction dispute into its precise legal origin: Tort, Contract, or Statutory Law.",
    "Apply the Arizona Economic Loss Rule (The Flagstaff Doctrine) to isolate pure economic losses.",
    "Position the boundary between general liability and professional lines to a business owner.",
    "Audit Master Service Agreements to identify uninsured financial liabilities before execution."
  ],
  "lexicon": [
    {
      "term": "Tort Liability",
      "definition": "A civil wrong independent of contract, usually negligence where breach of duty causes physical injury or tangible damage."
    },
    {
      "term": "Contractual Liability",
      "definition": "Liability triggered by breach of promises or warranties in a bilateral agreement, even without negligence."
    },
    {
      "term": "Pure Economic Loss",
      "definition": "Financial damages like delay penalties, rework cost, and lost rent without independent physical injury."
    }
  ],
  "technicalDeepDive": {
    "heading": "Statutory & Case Law Reality: The Line of Demarcation",
    "caseLawCitation": "Flagstaff Affordable Housing Limited Partnership v. Design Alliance, Inc. (2010)",
    "coreDoctrine": "A plaintiff cannot recover economic losses in tort where the dispute arises from contract, unless independent physical injury to persons or separate property exists.",
    "scenarios": [
      {
        "type": "Tort Lane",
        "description": "Improperly braced wall falls in a windstorm and crushes a third-party vehicle. CGL Coverage A is implicated."
      },
      {
        "type": "Contract Lane",
        "description": "Wall built off layout causes teardown, delay, and lost rent with no physical injury. CGL denies; E&O lane controls."
      }
    ]
  },
  "fieldExecution": {
    "strategyName": "Hammer vs Blueprint Drill",
    "script": "Mr. Contractor, if your crew drops a hammer and damages a finished surface, that is tort-driven property damage and your general liability can respond. But if your team misinterprets plans and creates a costly rework with delay and lost rent, Arizona ELR keeps that in contract lane and your CGL carrier can deny it. My job is protecting your balance sheet from the mistakes that do not break windows but can break your company."
  }
}`,
          quizzes: [
            {
              question: 'Under Arizona ELR, a plaintiff usually cannot recover in tort for purely economic loss when:',
              options: [
                { text: 'There is no contract anywhere in the project chain', explanation: 'Lack of privity can still produce tort avenues; this is not the core ELR trigger.' },
                { text: 'The loss arises from contract duties without independent physical injury to persons or other property', explanation: 'Correct. ELR confines these disputes to contractual remedies.' },
                { text: 'A subcontractor performed part of the work', explanation: 'Subcontractor involvement alone does not decide ELR application.' },
                { text: 'The owner alleges delay damages', explanation: 'Delay damages can be economic loss, but context still matters; the legal trigger is contract-based economic injury without independent physical injury.' },
              ],
              answer: 1,
            },
            {
              question: 'A contractor causes blueprint interpretation delay with no physical damage. Best transfer vehicle is:',
              options: [
                { text: 'CGL Coverage A', explanation: 'Coverage A needs occurrence-driven BI/PD, not pure economic delay.' },
                { text: 'Contractors Professional Liability (E&O)', explanation: 'Correct. This is error/omission driven economic loss.' },
                { text: 'Coverage C Medical Payments', explanation: 'Coverage C addresses minor no-fault medical expense, not project delay economics.' },
                { text: 'Workers Compensation', explanation: 'Workers compensation is employee injury statute, unrelated to owner economic delay claim.' },
              ],
              answer: 1,
            },
          ],
          blocks: [
            {
              type: 'TEXT',
              title: 'Tripartite Map',
              content: {
                body:
                  'Tort: duty/breach/causation/damages and CGL occurrence analysis.\nContract: performance and warranty promises; often CGL gap.\nStatutory: OSHA/ROC/code obligations, negligence per se impact, non-insurable fines.',
              },
            },
            {
              type: 'SIMULATION',
              title: 'ELR Line-of-Demarcation Drill',
              content: {
                body:
                  'Draft a 60-second client explanation separating hammer-drop property damage from blueprint delay economic loss and identify policy by loss lane.',
              },
            },
          ],
        },
        {
          title: 'Lesson 1.2 - Physical vs Economic vs Contractual Loss',
          contentType: 'INTERACTIVE',
          body:
            'Arizona generally treats faulty workmanship itself as business risk, but resulting damage to other property can trigger occurrence-based coverage analysis.',
          quizzes: [
            {
              question: 'In Arizona, faulty workmanship by itself is:',
              options: [
                { text: 'Always an occurrence', explanation: 'Incorrect. Arizona distinguishes defective work itself from accidental resulting damage.' },
                { text: 'Not an occurrence unless resulting damage to other property occurs', explanation: 'Correct. Resulting damage can satisfy occurrence/property damage pathway.' },
                { text: 'Always covered under completed operations', explanation: 'No. Exclusions and your-work analysis still govern.' },
                { text: 'Always excluded regardless of resulting damage', explanation: 'Too broad; resulting collateral damage can still be covered.' },
              ],
              answer: 1,
            },
          ],
          blocks: [
            {
              type: 'TEXT',
              title: 'Roof Flashing Case Split',
              content: {
                body:
                  'Pre-loss defect correction cost is contractual/economic. Post-storm collateral damage to drywall/equipment/loss-of-use can trigger Coverage A for resulting damage while defective component replacement remains contractor cost.',
              },
            },
            {
              type: 'EXERCISE',
              title: 'Classification Worksheet',
              content: {
                body:
                  'For each damage bucket, mark legal lane (tort/contract/statutory), policy section, and exclusion risk.',
              },
            },
          ],
        },
      ],
    },
    {
      title: 'Module 2 - Commercial General Liability for Contractors',
      lessons: [
        {
          title: 'Lesson 2.1 - Coverage A Trigger and Aggregate Strategy',
          contentType: 'INTERACTIVE',
          body:
            'Coverage A demands BI/PD caused by occurrence. Aggregate architecture (general vs products-completed ops) is strategic, especially with concurrent projects.',
          quizzes: [
            {
              question: 'CG 25 03 is primarily used to:',
              options: [
                { text: 'Set separate general aggregate by designated project', explanation: 'Correct. Prevents single-project erosion from wiping out all ongoing project capacity.' },
                { text: 'Convert occurrence to claims-made', explanation: 'No. Trigger form is not changed by this endorsement.' },
                { text: 'Replace products-completed aggregate', explanation: 'No. It modifies general aggregate behavior by project.' },
                { text: 'Add automatic additional insured status', explanation: 'AI status is handled by AI endorsements, not aggregate modifiers.' },
              ],
              answer: 0,
            },
          ],
          blocks: [
            {
              type: 'TEXT',
              title: 'Occurrence vs Claims-Made Reminder',
              content: {
                body:
                  'Occurrence form protects long-tail defect timing based on when damage occurred. Claims-made forms require claim made+reported during active term/ERP and careful retro date continuity.',
              },
            },
          ],
        },
        {
          title: 'Lesson 2.2 - Coverage B in Contractor Operations',
          contentType: 'TEXT',
          body:
            'Digital marketing, online competitor statements, and portfolio misuse create non-physical claims where Coverage B may be decisive.',
          quizzes: [
            {
              question: 'A contractor posting false competitor safety claims online most likely implicates:',
              options: [
                { text: 'Coverage B disparagement pathway', explanation: 'Correct. Potential personal/advertising injury allegation with defense trigger.' },
                { text: 'Coverage C medical payments', explanation: 'Coverage C is no-fault medical expense, unrelated to disparagement.' },
                { text: 'Workers compensation', explanation: 'Workers compensation addresses employee bodily injury, not publication offenses.' },
                { text: 'No CGL section at all', explanation: 'Potentially incorrect if Coverage B is intact and not excluded.' },
              ],
              answer: 0,
            },
          ],
          blocks: [
            {
              type: 'TEXT',
              title: 'Coverage B Restriction Watch',
              content: {
                body: 'Check for endorsements that strip personal/advertising injury in artisan contractor programs; negotiate removals where possible.',
              },
            },
          ],
        },
        {
          title: 'Lesson 2.3 - Coverage C Litigation Friction Control',
          contentType: 'TEXT',
          body: 'Coverage C can resolve small incident medical bills quickly and reduce escalation into larger negligence disputes.',
          quizzes: [
            {
              question: 'Coverage C generally requires negligence proof before payment.',
              options: trueFalseOptions(
                'Incorrect. Coverage C is designed as no-fault medical expense handling within policy conditions.',
                'Correct. No-fault structure is exactly why it can reduce litigation friction on small injuries.',
              ),
              answer: 1,
            },
          ],
          blocks: [
            {
              type: 'EXERCISE',
              title: 'Urgent-Care Resolution Protocol',
              content: {
                body: 'Build same-day intake and payment workflow that preserves facts without admissions while using Coverage C efficiently.',
              },
            },
          ],
        },
        {
          title: 'Lesson 2.4 - Business Risk Exclusions and Defect Minefield',
          contentType: 'INTERACTIVE',
          body:
            'Exclusions j, k, l and subcontractor exception dynamics drive real-world contractor coverage outcomes. Precision reading wins claims.',
          quizzes: [
            {
              question: 'Exclusion j is most associated with:',
              options: [
                { text: 'Ongoing operations and "particular part" analysis', explanation: 'Correct. j(5)/(6) are heavily litigated during active operations.' },
                { text: 'Only post-completion latent defects', explanation: 'Primarily exclusion l and completed ops concepts are post-completion focal points.' },
                { text: 'Professional design-only disputes', explanation: 'Professional liability exclusions are separate structures.' },
                { text: 'Employee injury statutory benefits', explanation: 'Workers compensation handles statutory employee injury benefits.' },
              ],
              answer: 0,
            },
          ],
          blocks: [
            {
              type: 'SIMULATION',
              title: 'Particular-Part Rebuttal',
              content: {
                body: 'Draft adjuster rebuttal isolating component worked on versus collateral property damage outside that particular part.',
              },
            },
          ],
        },
        {
          title: 'Lesson 2.5 - Additional Insured and P&NC Mechanics',
          contentType: 'INTERACTIVE',
          body: 'AI compliance is contract currency. Missing completed ops AI is a classic downstream transfer failure.',
          quizzes: [
            {
              question: 'Most sophisticated GC specs for AI require:',
              options: [
                { text: 'CG 20 10 only', explanation: 'Insufficient for post-completion defect transfer.' },
                { text: 'CG 20 37 only', explanation: 'Insufficient for ongoing operations transfer.' },
                { text: 'Both ongoing and completed ops AI equivalents', explanation: 'Correct. Dual period protection aligns with contractual intent.' },
                { text: 'No endorsements if COI says AI', explanation: 'COI language without endorsements creates severe breach and E&O risk.' },
              ],
              answer: 2,
            },
          ],
          blocks: [
            {
              type: 'EXERCISE',
              title: 'COI Misrepresentation Risk Drill',
              content: {
                body: 'Audit a certificate/endorsement mismatch and draft internal producer escalation note before site mobilization.',
              },
            },
          ],
        },
        {
          title: 'Lesson 2.6 - Practical Coverage and Contract Audit',
          contentType: 'INTERACTIVE',
          body: 'Capstone claim and contract practicals for Module 1 and 2 decision execution.',
          quizzes: [
            {
              question: 'Arizona anti-indemnity rule (ARS 32-1159) generally voids provisions requiring indemnity for:',
              options: [
                { text: 'Any shared negligence allocation', explanation: 'Comparative fault allocations can remain enforceable depending on wording.' },
                { text: 'Sole negligence or willful misconduct of promisee', explanation: 'Correct. That overreach is void as public policy in Arizona construction context.' },
                { text: 'Completed operations obligations', explanation: 'Completed operations transfer itself is not automatically void.' },
                { text: 'All additional insured requirements', explanation: 'AI requirements can still be valid if consistent with law/contract.' },
              ],
              answer: 1,
            },
          ],
          blocks: [
            {
              type: 'EXERCISE',
              title: 'Exercise 1 - Misguided Adjuster Rebuttal',
              content: { body: 'Write a formal rebuttal correcting ELR misuse, j(5) overbreadth, and loss-of-use property damage definition under CG 00 01.' },
            },
            {
              type: 'EXERCISE',
              title: 'Exercise 2 - Contractual Audit',
              content: { body: 'Produce statutory violation memo, policy impact, and corrected indemnity/AI/P&NC language package.' },
            },
          ],
        },
      ],
    },
    {
      title: 'Module 3 - Professional Liability (E&O) for Contractors',
      lessons: [
        {
          title: 'Lesson 3.1 - E&O and Pure Economic Loss Domain',
          contentType: 'INTERACTIVE',
          body:
            'Contractor E&O addresses error/omission-driven economic loss where CGL has no BI/PD occurrence pathway, especially in design-build, value engineering, and constructability recommendations.',
          quizzes: [
            {
              question: 'In the design-build glass substitution case with no physical damage, primary responding policy is:',
              options: [
                { text: 'CGL Coverage A', explanation: 'Coverage A needs occurrence-based BI/PD; pure thermal performance economic loss does not fit.' },
                { text: 'Contractors E&O', explanation: 'Correct. Negligent professional recommendation and economic remediation belong here.' },
                { text: 'Coverage C medical payments', explanation: 'No medical payments scenario exists in this case.' },
                { text: 'Workers compensation', explanation: 'No employee bodily injury statutory benefits issue is present.' },
              ],
              answer: 1,
            },
            {
              question: 'Why can "we hired an engineer" still leave GC exposed?',
              options: [
                { text: 'Because engineer policies always deny design claims', explanation: 'Not always; issue is not automatic denial.' },
                { text: 'Because owner sues contractual prime first and downstream E&O capacity can fail', explanation: 'Correct. Vicarious/downstream deep-pocket exposure remains with prime contractor.' },
                { text: 'Because CGL automatically covers design misrepresentation', explanation: 'Professional exclusions and no-occurrence mechanics often block CGL response.' },
                { text: 'Because Arizona forbids engineer E&O', explanation: 'No such general prohibition.' },
              ],
              answer: 1,
            },
          ],
          blocks: [
            {
              type: 'TEXT',
              title: 'CGL Trap in Professional Services',
              content: {
                body: 'Contractor professional exclusions can bar design/drafting/consulting-related claims. E&O is the balance-sheet backstop for these lanes.',
              },
            },
            {
              type: 'SIMULATION',
              title: 'Design-Build Mis-Specified System Claim Routing',
              content: {
                body: 'Draft carrier notice to E&O with trigger facts, retro date confirmation, and pure economic loss framing to avoid misrouted denial.',
              },
            },
          ],
        },
        {
          title: 'Lesson 3.2 - Claims-Made Mechanics and Prior Acts Continuity',
          contentType: 'INTERACTIVE',
          body:
            'Most contractor E&O forms are claims-made. Retro date continuity and ERP management are non-negotiable to protect latent defect exposure.',
          quizzes: [
            {
              question: 'When moving E&O carriers, the core placement rule is:',
              options: [
                { text: 'Advance retro date to inception for pricing leverage', explanation: 'Advancing retro date can erase years of prior-work protection.' },
                { text: 'Maintain full prior acts by matching retro date continuity', explanation: 'Correct. This preserves coverage for latent claims from earlier work periods.' },
                { text: 'Cancel tail rights automatically', explanation: 'ERP/tail can be critical depending on form and transition timing.' },
                { text: 'Use occurrence trigger for all E&O placements', explanation: 'Contractor E&O is predominantly claims-made, not occurrence.' },
              ],
              answer: 1,
            },
          ],
          blocks: [
            {
              type: 'EXERCISE',
              title: 'Prior Acts Trap Audit',
              content: {
                body: 'Given expiring retro date 2020 and quoted retro date 2026, draft producer warning memo and required correction language before bind.',
              },
            },
          ],
        },
      ],
    },
    {
      title: 'Module 4 - Workers Compensation for Arizona Contractors',
      lessons: [
        {
          title: 'Lesson 4.1 - Statutory Benefits, Exclusive Remedy, and MOD Factor',
          contentType: 'INTERACTIVE',
          body:
            'Arizona workers compensation is statute-governed. Exclusive remedy limits employee suit against compliant employer, while action-over pathways can still hit GC/sub contractual transfer structures.',
          quizzes: [
            {
              question: 'Exclusive remedy under compliant WC structure generally means:',
              options: [
                { text: 'Employee can still sue employer for negligence in tort as first option', explanation: 'Exclusive remedy generally channels remedy into statutory WC benefits.' },
                { text: 'Employee’s primary remedy against employer is statutory WC benefits', explanation: 'Correct. This is the core grand-bargain doctrine.' },
                { text: 'No one can ever be sued after workplace injury', explanation: 'Third-party tort actions can still occur (e.g., against GC).' },
                { text: 'CGL replaces WC for medical benefits', explanation: 'WC remains the statutory primary system for employee injury benefits.' },
              ],
              answer: 1,
            },
            {
              question: 'A MOD greater than 1.0 typically indicates:',
              options: [
                { text: 'Premium discount and easier institutional prequalification', explanation: 'Higher MOD usually means surcharge and weaker prequal profile.' },
                { text: 'Loss performance better than expected class average', explanation: 'MOD > 1.0 usually reflects worse-than-expected loss performance.' },
                { text: 'Surcharge pressure and potential bid disqualification risk', explanation: 'Correct. Elevated MOD can be commercially disqualifying in many procurement stacks.' },
                { text: 'No impact outside insurer internal rating', explanation: 'MOD often directly affects market access and qualification criteria.' },
              ],
              answer: 2,
            },
          ],
          blocks: [
            {
              type: 'SIMULATION',
              title: 'Action-Over Chain Mapping',
              content: {
                body: 'Map injury event from sub employee WC claim through third-party GC suit and indemnity tender back toward subcontractor transfer stack.',
              },
            },
          ],
        },
        {
          title: 'Lesson 4.2 - 1099/Sole Proprietor Minefield and Audit Defense',
          contentType: 'INTERACTIVE',
          body:
            'Arizona statutory employer logic and control analysis can collapse private 1099 paperwork. Operational reality and required forms govern audit outcome.',
          quizzes: [
            {
              question: 'Why can lawyer-drafted 1099 waivers still fail at WC audit?',
              options: [
                { text: 'Because Arizona ignores all written contracts categorically', explanation: 'Not categorically; issue is control/reality test overriding labels where control exists.' },
                { text: 'Because ARS/control standards evaluate operational reality over tax labels', explanation: 'Correct. Control/method/manner evidence drives classification outcomes.' },
                { text: 'Because all subcontractors must always be on GC payroll', explanation: 'Not universally; true independent entities can qualify when facts support it.' },
                { text: 'Because COIs are prohibited for subcontractors', explanation: 'COIs are essential evidence, not prohibited.' },
              ],
              answer: 1,
            },
            {
              question: 'For Arizona sole proprietors without WC, core field control before site access is:',
              options: [
                { text: 'Internal private waiver only', explanation: 'Private waivers alone are frequently insufficient for audit/statutory defense.' },
                { text: 'ICA 1312 workflow and insurance verification protocol', explanation: 'Correct. Formal process discipline is key to premium audit and statutory exposure control.' },
                { text: 'Verbal acknowledgment from foreman', explanation: 'Operationally weak and non-auditable.' },
                { text: 'Delay paperwork until post-audit', explanation: 'Too late; pre-work controls are critical.' },
              ],
              answer: 1,
            },
          ],
          blocks: [
            {
              type: 'EXERCISE',
              title: 'Premium Audit Crisis Response Plan',
              content: {
                body:
                  'Draft remediation memo: (1) legal diagnosis under ARS/control test, (2) mitigation evidence collection, (3) forward protocol with COI gate + ICA 1312 + holdback controls.',
              },
            },
            {
              type: 'EXERCISE',
              title: 'Design-Build Claim Filing Strategy',
              content: {
                body:
                  'Produce dual-track notice strategy explaining why CGL is non-responsive and E&O notice must emphasize pure economic loss, professional error, and timing compliance.',
              },
            },
          ],
        },
      ],
    },
  ],
};
