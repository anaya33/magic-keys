# Variations, expression and composing by feel

Status: idea, not started. Separate from the phone layout work.

## The problem

A piece of music isn't one fixed thing. The same piece gets played and written in
many different ways, and a lot of what makes it moving is expression and emotion:
how loud or soft, how fast or slow, where it breathes, which notes lean.

Magic Keys plays each song one way, from one score. Most of that variety is missing.

## What we want

1. **Variations of songs you like.** Take a piece and hear it played or rewritten in
   different ways: gentler, darker, faster, simpler, jazzier, as a lullaby. Keep the
   ones you like.
2. **Expression you can feel.** Change the feeling of a performance without knowing
   theory: more tender, more urgent, more playful. The app turns that into dynamics,
   timing, pedal and phrasing.
3. **Composing without knowing music.** Anyone should be able to make an original
   piano piece just by how they feel and what sounds good to them, and end up with
   something they can play in Magic and Learn.
4. **Training your ear.** A lot of music is about hearing. People can train their ear
   to hear in certain ways, and the app could help with that while they play.

## Things to keep in mind

- **Emotion and hearing both matter.** Feeling drives what people want; their ear
  decides what sounds right to them.
- **People hear differently.** More creative people tend to hear music differently
  from more technical people. The tools should work for both, not assume theory.
- **Piano only.** Everything here is about solo piano.
- **Original work.** Generated pieces should be new music, not copies of existing
  songs. Variations of public-domain pieces (like the ones in the library) are fine.

## Rough ideas for how

- Generative AI for variations and new pieces, working with notes (MIDI/MusicXML)
  rather than audio, so the results can show up as sheet music, tiles and Learn mode.
- Simple controls instead of theory words: sliders or words for mood, energy,
  complexity, and "more like this / less like this" on what you hear.
- An expression layer on top of any song (we already shape phrasing and dynamics in
  `src/modes/expression.ts`), extended to whole moods.
- Listen mode (currently switched off) could become a way to start a piece by
  humming an idea.

## Research to do

Look at what's known and what real piano players say, before building anything:

- **Scientific papers** on music emotion, expressive performance, how people with
  different backgrounds hear music, ear training, and generating symbolic piano music.
- **Forums:** Reddit (piano, composing, music theory communities), Bluesky, and other
  music forums: what people struggle with when composing and what they wish existed.
- **Instagram and YouTube creators who play piano:** focus on smaller and newer
  creators who are very musical, not big ad-backed accounts. How do they vary pieces,
  add feeling, improvise, and talk about it?
- **Composers** (YouTube and elsewhere): composing takes the technical side, the
  creative side and emotion together. How do they get from a feeling to a piece?
- **People who write original music, and people who write about music.** Songwriters
  and singers with their own pieces, and writers who describe music in words. There's
  an emotional side in how they write about it that the technical sources miss.
- **Old Tumblr posts, through the Wayback Machine.** A lot of genuine, personal writing
  about original pieces and how music feels lived on Tumblr. Archived copies on the
  Wayback Machine (web.archive.org) are a way to find it now.
- **Blogs with rich writing about piano expression.** Search the web for blogs that
  talk in depth about expression, feeling and interpretation, specifically for piano.

Every source is about the piano. When collecting from the web: read archived and
public pages only, respect each site's rules, summarise in our own words, and keep
quotes short with a link back. The point is to learn how people feel and talk about
music, not to copy their writing or their pieces.

What we want out of the research: the main ways people vary a piece, the handful of
expression controls that matter most, what non-musicians need to compose, the words
people use for how music feels, and which generation approaches give good, playable
piano music.

## The research loop

The research doesn't happen once. It runs as a closed loop until it stops finding
anything new:

1. **Gather** from the sources above into the research doc (`variations-research.md`).
2. **Sum up** what was found: patterns, the words people use, what matters most.
3. **Find the gaps:** questions still open, claims with only one source, sources
   that disagree, kinds of people not heard from yet.
4. **Go back** to step 1, aimed at those gaps.

Stop when a full round adds nothing new (the same patterns keep coming back). Each
round is written down in the doc, so the loop can pick up where it left off.

## Making

Once the research loop has settled, turn it into the thing itself, in this order:

1. **Variations:** take a piece and make versions of it (gentler, darker, simpler …),
   playable in Magic and Learn.
2. **Expression:** controls for feeling, in the words people actually use, applied to
   any song.
3. **Composing:** make an original piano piece from how you feel and what sounds good
   to you, no theory needed.

Each one gets tried by ear and fed back into the loop: what people say about the
results becomes new research questions.

## Open questions

- Should generation run on the device, or call a hosted model?
- How do we let people save and share their own variations and pieces?
- How do we judge "good" for someone who can't read music: by ear only?
