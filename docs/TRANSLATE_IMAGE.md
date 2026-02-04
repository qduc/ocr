## Pipeline

### 1) Create a clean “background plate” (remove original text)

**What:** erase the original text so you can place new text into clean pixels
**Options (in order of ease):**

* **OpenCV inpainting (Telea / Navier-Stokes)** using a mask of the text
* **Patch-based / texture synthesis**
* **Diffusion inpaint** (best quality, heavier)

**Complexity:**

* OpenCV inpaint: **2**
* Patch/texture synthesis: **3–4**
* Diffusion inpaint: **4–5**

**Quick win:** ✅ **YES** (OpenCV inpaint with a good mask is huge)

**Notes that matter a lot:**

* Expand your mask slightly (dilate) so you remove edge halos of the original glyphs.
* If you have polygons, rasterize them to a mask with padding.

---

### 2) Decide typography (font + size + line breaks)

**What:** pick a font that matches “enough” and fit translation into the region
**Approaches:**

* **Font library + heuristic matching** (sans/serif/mono + weight guess)
* **Font classification model** (harder)
* **“Good-enough” font substitution per language** (often sufficient)

**Complexity:**

* Heuristic + a curated font set: **2–3**
* ML font ID: **4–5**

**Quick win:** ✅ **YES** if you do a simple heuristic and focus on spacing + blending later.

**Big practical tip:** Don’t over-invest in perfect font ID initially. If your blending is good, “close font” looks surprisingly natural.

---

### 3) Layout: wrap, align, and fit text into the region

**What:** line breaking + font size adjustment + alignment (left/center/right)
**How:**

* Measure rendered text width/height using a text renderer (Pillow, HarfBuzz, Pango/Cairo)
* Binary search font size to fit box
* Wrap by words; for CJK, wrap by characters
* Respect original line count if you have it (helps realism)

**Complexity:** **2–3**
**Quick win:** ✅ **YES** (bad layout screams “monkey patch”)

---

### 4) Geometry: perspective / warp to match the surface

**What:** text follows sign/paper/skew, not pasted flat
**How:**

* If you have a quadrilateral for the text region: compute **homography** and warp rendered text
* If curved surfaces: approximate with **piecewise warps** or thin-plate spline (TPS)

**Complexity:**

* Homography warp: **2**
* TPS / curved: **4**

**Quick win:** ✅ **YES** for planar surfaces (homography)

---

### 5) Color and illumination matching

**What:** make text “inherit” lighting conditions
**Simple effective method:**

* Sample local background stats near the region
* Set text color based on original text color estimate (if available) or contrast target
* Apply a subtle shading factor based on background luminance

**Complexity:** **2–3**
**Quick win:** ✅ **YES** (color mismatch is an instant giveaway)

---

### 6) Texture blending (the “printed-on” effect)

**What:** let paper grain / wall texture show through text
**Programmatic blend tricks (very effective):**

* Multiply or Overlay blend modes instead of normal alpha
* Use “blend if”-like logic: modulate text alpha by local texture contrast
* Add tiny variations to alpha using high-frequency component of background

**A good approach:**

1. Extract background high-frequency texture: `tex = bg - GaussianBlur(bg)`
2. Use `tex` to slightly modulate text intensity/alpha.

**Complexity:** **3**
**Quick win:** ✅ **YES** (this is one of the biggest realism boosts)

---

### 7) Add micro-imperfections (noise + slight blur + edge wear)

**What:** remove the “too crisp / too clean” digital look
**Do:**

* Add low noise to text layer (match image noise level)
* Apply tiny blur (0.2–0.7px depending on resolution)
* Optional: erode/dilate text mask slightly for edge roughness

**Complexity:** **1–2**
**Quick win:** ✅ **YES** (cheap and very high impact)

---

### 8) Global re-grain / unify

**What:** unify the final composite so everything shares the same noise/sharpness
**How:**

* Add tiny noise to whole image
* Apply mild sharpening or match blur globally (carefully)

**Complexity:** **1–2**
**Quick win:** ✅ Yes (especially if your source is a photo)
