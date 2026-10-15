# Capture fixtures

`scripts/capture-shots.mjs` feeds a real file into the AI upload flow for shot
03. Put it here as `sample-lecture.pdf`, or point `ROAMLY_SAMPLE_NOTES` at one
somewhere else.

```bash
cp ~/Downloads/"11. Abdominal Pain.pdf" fixtures/sample-lecture.pdf
```

**The contents of this directory are gitignored on purpose.** Lecture slides are
usually the property of a program or an instructor, and a marketing repo is the
wrong place for them. Keep the file local.

Two things to check before you use a deck on camera:

- You have the right to show it publicly. The upload shot puts the filename and
  a thumbnail on screen.
- No school name, instructor name, or copyright line is legible in the frames
  that end up in the video. Check this on the contact sheet — if something is
  visible, blur it or pick a different file.

PDF, PowerPoint, Word, images, and plain text all work.
