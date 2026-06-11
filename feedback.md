# Feedback

| Date | Comment |
|------|---------|
| 2026-05-13 | The paper stories tend to start each chapter with "This chapter matters because xxx". The narrative should not be so mechanical but instead flow as a well-written narrative, even if the intent is to articulate why the chapter matters. |
| 2026-05-13 | Add more metadata to the paper excerpts panel on the first (Overview) chapter: authors, month and year of publication, and institutions (if available). |
| 2026-05-22 | Explanations should be self-contained — readers should not need to read the paper excerpt to follow along. The excerpt is optional reference material, not a prerequisite. Don't assume the reader is reading excerpts and explanations side by side. |
| 2026-05-23 | Font size feels a tad small to read on mobile. |
| 2026-06-11 | Collection story validation should be driven by story.sourceType, not only by the number of sources the LLM emitted — a collection story with 0 or 1 sources in the output should be rejected, and excerpts without sourceId should be caught. |
| 2026-06-11 | Generation should fail upfront when any collection source is unreadable (e.g. invalid arXiv ID alongside a valid PDF), with an error message identifying which source failed. |
