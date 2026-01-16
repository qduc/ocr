Here are the most common pitfalls that reliably produce bad results:

## 1) Feeding the wrong kind of text region

* **Multi-line paragraphs** or whole pages instead of **single words/lines**. TrOCR is a seq2seq recognizer, not a layout engine; it tends to “smear” lines together, skip lines, or hallucinate.
* **Bad crops**: missing first/last characters, tight bounding boxes that cut ascenders/descenders, or lots of background around small text.
* **Rotated / skewed / curved text** (photos of documents, book curves) without deskewing/rectification.

**Symptom:** dropped characters at the edges, merged words, random inserts.

## 2) Resolution + resizing mistakes

* **Text too small** (low DPI, distant photos). Once characters are only a few pixels wide, the model guesses.
* **Aggressive resizing** that squashes aspect ratio or downscales too much.
* **Padding strategy** that changes the apparent scale (e.g., huge padding around tiny text → model sees “small noisy line”).

**Rule of thumb:** keep strokes crisp; if you resize, preserve aspect ratio and avoid making characters tiny.

## 3) Preprocessing that destroys signal

These are super common because they “look better” to humans but remove cues the model uses:

* **Over-binarization / hard thresholding** (especially on faint ink or uneven lighting).
* **Over-sharpening / denoising** that creates halos or wipes thin strokes.
* **Inversion mistakes** (white text on black background vs black on white) without normalizing consistently.
* **JPEG artifacts** from recompressing images.

**Symptom:** consistent confusion between similar glyphs (O/0, I/l/1, rn/m), missing diacritics, broken punctuation.

## 4) Not using the model’s processor correctly

With Hugging Face TrOCR, the `TrOCRProcessor` isn’t optional fluff:

* Skipping it (or mixing components from different models) can mean **wrong resize**, **wrong normalization**, **wrong tokenizer**.
* Feeding grayscale images as 1-channel tensors without converting to what the encoder expects (typically 3-channel RGB-like input).

**Symptom:** overall gibberish, weird spacing, sudden quality drop compared to examples.

## 5) Decoding settings that silently sabotage output

Autoregressive decoding is sensitive:

* **`max_new_tokens` / `max_length` too small** → truncation.
* **Beam search too narrow** or greedy decode on noisy images → brittle output.
* **No length penalty / bad `no_repeat_ngram_size`** → repeated fragments or early stopping.
* **Forcing/forgetting special token IDs** (`pad_token_id`, `eos_token_id`, `decoder_start_token_id`) → messy generations.

**Symptom:** cut-off lines, repeated words, output that ends too early.

## 6) Language + character set mismatch

* Using an English/Latin-trained model on **Vietnamese with lots of diacritics**, or on mixed scripts, math, code, serial numbers.
* Expecting it to nail **rare punctuation** or formatting (e.g., tables, aligned columns, invoice-like layout) without domain fine-tuning.

**Symptom:** diacritics dropped/substituted, punctuation drift, spacing wrong, “helpful” hallucinations.

## 7) Fine-tuning pitfalls (if you train your own)

* **Training on unaligned labels** (ground truth doesn’t match the crop exactly).
* **Dirty text labels** (extra spaces, inconsistent normalization, different quote characters).
* **Too little/too narrow data** → overfitting; model memorizes fonts/backgrounds.
* **Catastrophic forgetting** when fine-tuning hard on a tiny domain set.
* Evaluating with only exact match, ignoring CER/WER and normalization rules → you think it’s worse/better than it is.

**Symptom:** great train metrics, terrible real-world OCR; or great on one font, awful elsewhere.

## 8) Missing the “rest of OCR” (TrOCR isn’t a full OCR system)

TrOCR recognizes text **given a decent crop**. If detection/segmentation is weak:

* Bad line detection → everything downstream looks like a “TrOCR problem.”
* No reading order / layout handling → outputs are scrambled.

**Symptom:** random word order, merged lines, inconsistent results across pages.