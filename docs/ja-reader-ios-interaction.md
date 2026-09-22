# Japanese Reader - iPadOS interaction design

Companion to `ja-reader-design.md` and `ja-reader-dictionary.md`. This file
decides how the reader is actually operated on an iPad. Everything here assumes
**iPadOS 26.6** and treats desktop as a secondary target.

## 1. What the target device gives us

| Fact | Consequence |
| --- | --- |
| iPadOS 26.6, well past the 17.2 requirement for the CSS Custom Highlight API | use the native highlight path; the DOM-wrapping fallback is out of scope |
| On iPadOS 26, "Add to Home Screen" **defaults to web app mode**, with a toggle to demote it to a bookmark | the standalone install we need for storage persistence is now the default path, no special instructions required |
| Apple Pencil hover on M2-and-later iPads fires pointer events with `pointerType === 'pen'` | a real hover channel exists, which is otherwise absent on iPad - use it |
| **WebKit bug 269535: no pen pointer events while a touch is present** | never design a gesture that requires a finger and the Pencil down at the same time |
| WebKit bug 301994: on iPadOS 26.1 the status bar stayed visible in fullscreen home-screen web apps | verify standalone chrome on 26.6 early; do not assume the status bar area is ours |
| No File System Access API | book files must be copied into IndexedDB |

## 2. Two design principles

**1. Finger navigates, Pencil annotates.** A finger is a blunt instrument and the
Pencil is a precise one. Assigning navigation to the finger and text-level work
to the Pencil mirrors pen and paper, and removes the worst gesture conflicts.

**2. Never fight the operating system.** iOS owns long-press, the selection
callout, edge swipes, and the scroll bounce. The reader should own tap, its own
swipe handling, and everything reachable through the text model, and leave the
rest alone.

## 3. Gesture map

Reading mode is the default and suppresses native selection
(`user-select: none` plus `-webkit-touch-callout: none` on the text block).

| Gesture | Reading mode | Selection mode |
| --- | --- | --- |
| Finger tap on text | look up the word under the tap | place the selection at that character |
| Finger tap outside the text block | toggle the chrome | exit to reading mode |
| Finger horizontal swipe | turn the page | - |
| Finger drag on text | nothing (captured for swipe) | extend the selection |
| Finger double tap on text | select the sentence | select the paragraph |
| Finger long press | pin the dictionary sheet open | native selection, if it works (see section 11) |
| Two-finger pinch | font size | font size |
| Two-finger tap | toggle chrome | toggle chrome |
| **Pencil tap on text** | look up (precise) | set the selection anchor |
| **Pencil drag across text** | **highlight** | extend the selection |
| **Pencil hover** | preview the reading, on-demand furigana | same |
| Keyboard Space / arrows | turn the page | - |
| Keyboard Cmd +/- | font size | font size |

Long press is worth a note: it is the gesture iOS most wants for itself. Because
the text block disables selection in reading mode, the callout never appears and
long press is free. Using it to pin the dictionary sheet open is natural and
costs nothing.

## 4. Tap resolution: the imprecision problem

At a typical reading size a kanji is 18-24 CSS pixels, while a fingertip is
roughly 40-50 of them. A raw tap therefore cannot reliably hit a word, and this
is the single biggest usability risk in the whole feature.

Three mitigations, all of which are needed:

1. **Snap to token.** Convert the tap point to a text offset, then expand to the
   token boundary that contains it. Because the chapter is already tokenised, the
   user is always selecting a word, never a character. This absorbs most of the
   error.
2. **Make the mistake cheap to fix.** The looked-up word is visibly highlighted,
   and the popup carries previous-word and next-word controls. Correcting a wrong
   pick is one tap, not a careful re-aim. This matters more than raw accuracy.
3. **Give the Pencil the precise job.** Pencil taps are accurate to the point of
   the tip. A reader with a Pencil attached will naturally stop using the finger
   for lookup.

Additional support: font sizes below a floor are not offered, and line spacing
gets a floor, so the tap target never becomes absurdly small.

## 5. The lookup surface

Two levels, because monolingual definitions are long and a bubble near the word
cannot hold them.

- **Bubble** - anchored near the word, showing the reading, part of speech, and
  the first line or two of the first sense. Offset away from the touch point so
  the finger never covers it. Tapping the bubble opens the sheet.
- **Sheet** - a draggable bottom sheet in portrait, roughly 45% to 95% height,
  containing the full entry: all senses, cross-references, kanji breakdown, and
  the per-word actions (add to deck, highlight, note, search).

Placement rules:

- keep the bubble inside `visualViewport`, not merely the layout viewport;
- in vertical mode the bubble prefers the left side of the word, matching the
  direction of reading and keeping clear of the finger;
- if the tapped word is in the bottom third of the screen, the bubble flips above;
- the sheet always covers the bottom, so it never collides with the finger.

Cross-references inside a monolingual definition are clickable and push onto a
small in-sheet history stack, so one look-up leading to another does not lose the
first. This matters more in JP-JP than it does in JP-EN.

## 6. Pagination and page turning

**Vertical mode is paginated, not scrolled.** A horizontal scroll of vertical
columns is awkward to aim and awkward to resume; a page turn is what a Japanese
book does.

- Implementation: CSS multi-column inside a fixed-size container, advancing one
  column per turn.
- Turn by horizontal swipe, or by tapping the left and right margin strips once
  that padding is generous. Swipe is primary because it never collides with
  tap-to-look-up.
- **Only the text block receives taps for lookup. The margins are navigation.**
  This is how the conflict is resolved: a tap lands either on text or on nothing,
  and the two mean different things.
- In landscape, two columns are shown side by side, which is the classic
  spread layout.
- Progress is stored as a text offset, so rotating the device, changing the font
  size, or toggling furigana all return to the same sentence. This falls out of
  the text model for free and is the main reason that model was chosen.

**Horizontal mode scrolls continuously**, with the same tap semantics. No page
turns.

## 7. Furigana on an iPad

There is no hover on a touch device, so the on-demand policy needs a different
trigger than on desktop.

- **Pencil hover** is the ideal trigger where the hardware supports it: the
  reading appears as the Pencil passes over a word, with no touch and no
  commitment.
- **Tap** also reveals the reading, in the bubble, for every word.
- **Persistent policies** (off, non-jōyō only, unknown-only, full) remain
  available as settings, because they are about typography rather than gesture.

Critical rule: toggling furigana must not move the reading position by even a
line. Because annotations live in the text model as offsets and ruby is applied
as a decoration layer, the position is preserved; this is a design requirement,
not a nice-to-have, and it should be tested by toggling on every page.

## 8. Selection and annotation without fighting iOS

Text offsets make selection a data problem, not a gesture problem, so the reader
does not need drag handles for the common cases:

- tap a word, double tap a sentence, double tap again for the paragraph;
- the granularity boundary comes from the tokeniser, so a "sentence" is a real
  sentence rather than a regex approximation;
- an action bar appears with highlight, note, copy, search, and add to deck.

**Pencil drag is the highlighter.** Dragging the Pencil across a run of text
paints a highlight, exactly like a marker on paper. This is the single most
natural use of the Pencil in the app, and it works because reading mode has
already disabled native selection.

Selection mode exists as an escape hatch for anyone who wants the system's
selection and share sheet. Whether it can delegate to native selection depends
on section 11.

## 9. Notes

- Selecting text and choosing "note" opens a small editor; the keyboard is
  handled with `visualViewport` so the sheet stays above it, never behind it.
- iPadOS Scribble works inside the note field for free, so a Pencil user can
  write the note by hand and have it converted.
- Notes save automatically on blur or after a pause; there is no save button to
  forget.
- A note marker is positioned from the range's bounding box, in the left gutter
  in vertical mode and the right gutter in horizontal mode.

## 10. Chrome and layout

- **Auto-hiding.** Chrome is hidden while reading and appears on a margin tap, a
  two-finger tap, or a top-edge tap. It hides again after a few seconds in
  paginated mode.
- **Top bar**: back to library, title, bookmark list, settings.
- **Bottom bar**: progress slider, page indicator, chapter jump, theme, furigana
  policy. The slider matters most: it is the only fast way to move around a long
  novel, and it sits where a thumb naturally rests.
- **Safe areas** are respected with `env(safe-area-inset-*)`, and in standalone
  mode the top bar must clear the status bar region.
- `overscroll-behavior: contain` on the reader container, so a swipe that
  reaches the end of a chapter does not bounce the whole page.
- Page turn animations respect `prefers-reduced-motion`.

## 11. Open risks that must be spiked on the device

These decide implementation choices and should be tested before the
corresponding feature is built, not after.

1. **Caret from a point on vertical text.** Does `caretRangeFromPoint` /
   `caretPositionFromPoint` return a correct offset inside
   `writing-mode: vertical-rl`? Everything in section 4 depends on this.
2. **Native selection in vertical text.** Does iOS selection behave correctly in
   vertical-rl? If yes, selection mode is free. If not, the reader needs its own
   offset-based selection with handles.
3. **Multi-column pagination.** Does a `column-width` container with vertical
   writing mode advance predictably, and can the current column be computed
   reliably for the progress indicator?
4. **Custom Highlight API on vertical text.** WebKit has open bugs around
   highlights on flexbox nodes and around text-decoration positioning in vertical
   writing mode. Confirm highlights paint correctly on vertical columns.
5. **Pencil hover in standalone mode.** Confirm that `pointerover` with
   `pointerType === 'pen'` actually fires in an installed home-screen web app.
6. **Home-screen web app on 26.6.** Standalone layout, status bar behaviour, and
   whether IndexedDB and Cache Storage survive across launches.
7. **Storage grant.** The result of `navigator.storage.persist()` and the
   numbers from `navigator.storage.estimate()` on the real device, before
   committing to a download-everything feature.
8. **Chapter render cost.** A long chapter with furigana applied, measured on the
   device. This sets whether chapters are rendered eagerly or a screen at a time.
9. **Large unzip on device.** Unzipping a large EPUB and a large Yomitan
   dictionary without being killed by the memory ceiling.

## 12. Typography defaults for Japanese on iPad

- **Font**: prefer a Mincho stack - `Hiragino Mincho ProN`, `Yu Mincho`,
  `Noto Serif JP` - which is installed on iPadOS, so no webfont download. A
  serif face is what long-form Japanese is set in, and it is much easier to read
  at length than a UI sans.
- **Size**: Japanese needs a larger size than Latin for the same comfort. Start
  around 19-20 CSS pixels with a floor well above the tap-target minimum.
- **Leading**: generous; roughly 1.8 to 2.0 in horizontal mode, expressed as the
  column width in vertical mode.
- **Margins**: generous, because they are also the navigation surface.
- **Themes**: white, 生成り (warm paper, the classic 文庫本 feel), dim sepia, and
  dark. The dark theme should be a warm dark rather than pure black on white,
  which is harsh on an LCD iPad over long sessions.
- `-webkit-text-size-adjust: 100%@ so Safari does not silently rescale the text.

## 13. Offline and storage

The dictionary is explicitly downloadable in full, so the reader needs real
storage management rather than a cache that might or might not be there.

- A storage screen showing what is downloaded, its size via
  `navigator.storage.estimate()`, and a download-all button with progress.
- `navigator.storage.persist()` is requested on first meaningful interaction.
- If persistence is refused, or if the reader is not installed to the home
  screen, the UI warns that downloaded data may be cleared after seven days of
  inactivity, and offers a one-tap re-download.
- Books are stored in IndexedDB because there is no persistent file handle.
- A "free up space" action that drops token caches and entry shards while keeping
  annotations, which are the only irreplaceable data.

## 14. Desktop as the secondary target

The same code serves desktop, where hover exists and the Pencil does not. The
only branch is the furigana trigger: hover on desktop, tap or Pencil hover on
iPad. Everything else is shared. Keyboard shortcuts are worth wiring up on both,
because the user may attach a Magic Keyboard to the iPad, where they matter as
much as on a desktop.

## 15. Implementation status

Written after the fact, so the plan above stays the plan and this section says
what is actually built.

| Gesture | State |
| --- | --- |
| Finger tap on text | done - looks up the word and opens the sheet |
| Finger tap outside the text block | done - margins page-turn, the centre toggles chrome |
| Finger horizontal swipe | done |
| Finger double tap on text | done - sentence, then paragraph on a repeat |
| Pencil tap on text | done - precise lookup, same sheet |
| Pencil drag across text | done - highlights, snapped to whole words, persisted |
| Pencil hover | done - reading preview once the tip rests on one word |
| Keyboard Space and arrows | done |
| Two-finger pinch / two-finger tap | not implemented |
| Finger long press | not implemented; nothing pins yet |

Deviations worth knowing:

- The bubble exists only for Pencil hover. A finger tap goes straight to the
  sheet, because the finger covers the bubble's own anchor and two taps to read
  one word is one too many.
- Selection has no drag handles and no native selection mode. Double tap is the
  only way in; the action bar is メモ / 蛍光 / コピー / 辞書 / 解除.
- Notes exist: select, メモ, type. A note saves on a pause and on blur, so there
  is no save button to forget, and iPadOS Scribble writes into the field
  unchanged. The marker is an **overlay** dot placed from the range's bounding
  box, not a `<span>` wrapped around the text. Wrapping was the plan; it is
  also the one approach that mutates the text nodes the offset model is built
  from, so the overlay is the safer shape. The cost is a reposition pass on
  scroll, which is frame-aligned.
- Highlights still use the Custom Highlight API with no span-wrapping fallback,
  but that no longer blocks anything: the note marker comes from the overlay.
- Generated furigana does not exist, so Pencil hover shows a reading only for
  words the loaded dictionary knows. After a Yomitan import that is most content
  words; before one it is almost none.
