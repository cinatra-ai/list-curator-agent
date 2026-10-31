# Attribution-record correction — fe0f6caa (review edits)

Forward correction (the Truthful Attribution protocol) for the verification record
of squash commit `fe0f6caa8b52ab3d41ad199d883af32b5f799d15`
("Let an edit made at a review reach the step that uses it (#71)").

## What was wrong
The squash landed with a gate-suite verification record, but its `Assisted-by`
record names only the agent that built the change.
The findings of independent read-only reviews by another agent drove the
changes of two of its three commits:
`b2fe81f26be7014c3139494b2bcac7ed3f9eae28` answers the findings of the first review, and
`821497bdd1b5237b519d7216baf66221dccca057` answers the findings of the second.
The reviewing agent therefore materially changed the diff and belongs in the record.

## The corrected truthful record for fe0f6caa

The corrected record names the building agent and the reviewing agent.
The change itself is untouched. The commit that adds this file carries the
two corrected Assisted-by lines in its trailer block and `Correction-for: fe0f6caa8b52ab3d41ad199d883af32b5f799d15`.
