import markSvg from "../../docs/media/mark.svg?raw";

// The mark of the lab (B1): a sample tube, its liquid, and one line from its foot that branches into the three records A, B and C (a circle, a square and a triangle: the shape says which, the colour
// only repeats it, ADR-0011). It is drawn in code for this project, under its licence (ADR-0008, ADR-0021: no image file, no icon set). The drawing has one source, docs/media/mark.svg: the READMEs show
// that file, both pages use it as their icon, and the explainer inlines the same file (site/infographic/build.py). The file carries its own palette for the places that cannot restyle it (a README, a
// tab); here the palette is dropped and style.css colours the three classes of the drawing from the theme tokens, so a theme or the dark scheme recolours the mark with the rest of the page. (The palette
// is dropped, not kept, because a <style> inside an inline SVG is a style element in the SVG namespace, and the page's walks of text read its digits as numbers.)
// The mark is decoration: aria-hidden, no text of its own; the name beside it stays text.
const PALETTE = /<style>[\s\S]*?<\/style>\s*/;
export const MARK_INLINE = markSvg.replace(PALETTE, "").trim();

export function Mark() {
  return <span class="mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: MARK_INLINE }} />;
}
